"""Pramaan Execution Runner: Check Discovery, O(1) LRU Cache, and SSE Async Streaming."""

from __future__ import annotations

import asyncio
import importlib
import logging
import pkgutil
import threading
import time
from collections import OrderedDict
from collections.abc import AsyncIterator

from pramaan.domain import Canon, ContentAST, Finding, NodeKind, Tier
from pramaan.engine.check import Check
from pramaan.erp import current_erp_tenant

logger = logging.getLogger(__name__)

_CacheKey = tuple[str, str, str, str, str]
_CACHE: OrderedDict[_CacheKey, tuple[Finding, ...]] = OrderedDict()
_CACHE_MAX = 2048
_CACHE_LOCK = threading.Lock()
_CHECKS_LOCK = threading.Lock()
_CACHED_CHECKS: tuple[Check, ...] | None = None
# ERP-backed checks depend on live tenant database state and must never serve stale cached values.
_UNCACHEABLE_CHECKS: frozenset[str] = frozenset({"claim.algebra_z3"})


def _discover_checks(package_name: str = "pramaan.checks") -> None:
    try:
        pkg = importlib.import_module(package_name)
    except ModuleNotFoundError:
        return
    if pkg.__path__ is None:
        return
    for _finder, mod_name, _ispkg in pkgutil.walk_packages(pkg.__path__, prefix=f"{package_name}."):
        try:
            importlib.import_module(mod_name)
        except Exception:
            logger.exception("Failed to import check module %s", mod_name)


def instantiate_checks() -> list[Check]:
    global _CACHED_CHECKS
    if _CACHED_CHECKS is not None:
        return list(_CACHED_CHECKS)
    with _CHECKS_LOCK:
        if _CACHED_CHECKS is None:
            _discover_checks()
            _CACHED_CHECKS = tuple(cls() for cls in Check.get_all().values())
        return list(_CACHED_CHECKS)


def _active_checks(canon: Canon) -> list[Check]:
    checks = instantiate_checks()
    if canon.enabled_checks:
        enabled = set(canon.enabled_checks)
        return [c for c in checks if c.check_id in enabled]
    return checks


def _cache_get(key: _CacheKey) -> list[Finding] | None:
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is not None:
            _CACHE.move_to_end(key)
            return list(entry)
    return None


def _cache_put(key: _CacheKey, items: list[Finding]) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = tuple(items)
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)


def _stamp_latency(findings: list[Finding], elapsed_ms: float) -> list[Finding]:
    ms = round(elapsed_ms, 2)
    return [
        f.model_copy(update={"trace": f.trace.model_copy(update={"latency_ms": ms})})
        if f.trace.latency_ms is None
        else f
        for f in findings
    ]


def _sort_findings(ast: ContentAST, findings: list[Finding]) -> list[Finding]:
    findings.sort(
        key=lambda f: (
            ast.index_of(f.node_id),
            f.locator.sort_key,
            -f.severity,
            f.check_id,
            str(f.id),
        )
    )
    return findings


def _lookup_cached_node(
    tenant_id: str, chk: Check, node_id: str, canon_hash: str
) -> tuple[bool, _CacheKey, list[Finding] | None]:
    cacheable = chk.check_id not in _UNCACHEABLE_CHECKS
    key: _CacheKey = (tenant_id, chk.check_id, chk.check_version, node_id, canon_hash)
    return cacheable, key, (_cache_get(key) if cacheable else None)


def run_checks_sync(ast: ContentAST, canon: Canon) -> list[Finding]:
    checks = _active_checks(canon)
    tenant_id = current_erp_tenant()
    collected: list[Finding] = []
    for chk in checks:
        for node in ast.nodes:
            if node.kind not in chk.node_kinds:
                continue
            cacheable, key, cached = _lookup_cached_node(tenant_id, chk, node.id, canon.hash)
            if cached is not None:
                collected.extend(cached)
                continue
            t0 = time.perf_counter()
            res = _stamp_latency(chk.run(node, canon), (time.perf_counter() - t0) * 1000.0)
            if cacheable:
                _cache_put(key, res)
            collected.extend(res)

        t0 = time.perf_counter()
        bres = _stamp_latency(chk.run_bundle(ast.nodes, canon), (time.perf_counter() - t0) * 1000.0)
        collected.extend(bres)

    return _sort_findings(ast, collected)


async def run_checks_stream(ast: ContentAST, canon: Canon) -> AsyncIterator[Finding]:
    checks = _active_checks(canon)
    tenant_id = current_erp_tenant()
    for chk in checks:
        for node in ast.nodes:
            if node.kind not in chk.node_kinds:
                continue
            cacheable, key, cached = _lookup_cached_node(tenant_id, chk, node.id, canon.hash)
            if cached is not None:
                for item in cached:
                    yield item
                continue
            t0 = time.perf_counter()
            offload = chk.tier != Tier.TIER_1 or node.kind == NodeKind.IMAGE
            res = await asyncio.to_thread(chk.run, node, canon) if offload else chk.run(node, canon)
            stamped = _stamp_latency(res, (time.perf_counter() - t0) * 1000.0)
            if cacheable:
                _cache_put(key, stamped)
            for item in stamped:
                yield item

        t0 = time.perf_counter()
        bres = (
            chk.run_bundle(ast.nodes, canon)
            if chk.tier == Tier.TIER_1
            else await asyncio.to_thread(chk.run_bundle, ast.nodes, canon)
        )
        for item in _stamp_latency(bres, (time.perf_counter() - t0) * 1000.0):
            yield item


async def run_checks_collect(ast: ContentAST, canon: Canon) -> list[Finding]:
    items = [f async for f in run_checks_stream(ast, canon)]
    return _sort_findings(ast, items)
