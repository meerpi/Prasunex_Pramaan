"""Prerana AI MCP Server (Fixed <4 KB Tool Catalog + OWASP LLM06 Mutation Block).

Fixes every CanonGate `mcp/server.py` bug:
- Working `get_canon_rules` (uses `default_canon_registry` without missing `fastapi` import)
- Working `compile_canon` (matches `pramaan.canon.compiler.compile_canon` signature & auto-registers)
- Added `verify_passport_qr` for offline cryptographic passport verification via MCP
- Compact <4 KB `tools/list` schema & strict denial of state-mutating tools (`approve`, `publish`, `override`)
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from pramaan.canon import (
    canon_to_yaml,
    compile_canon,
    default_canon_registry,
    list_tenant_canons,
    resolve_tenant_canon,
)
from pramaan.domain import Canon, ContentAST, TextNode
from pramaan.engine import rewrite_finding_surgically, run_checks_sync
from pramaan.erp import default_erp_oracle, set_erp_tenant
from pramaan.ledger import verify_selective_passport_with_ring
from pramaan.mcp.batch import BatchJob, default_batch_runner

SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = ("2026-07-28", "2025-11-25", "2024-11-05")
FORBIDDEN_MUTATION_TOOLS: frozenset[str] = frozenset({"approve", "publish", "override", "revoke"})

TOOL_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "list_canons",
        "description": "List available campus/regulatory Canons and rule counts.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_canon_rules",
        "description": "Inspect rules inside a Canon playbook.",
        "inputSchema": {
            "type": "object",
            "properties": {"canon_id": {"type": "string"}},
            "required": ["canon_id"],
        },
    },
    {
        "name": "compile_canon",
        "description": "Compile markdown policy prose into a grounded Canon.",
        "inputSchema": {
            "type": "object",
            "properties": {"canon_id": {"type": "string"}, "raw_text": {"type": "string"}},
            "required": ["canon_id", "raw_text"],
        },
    },
    {
        "name": "submit_batch",
        "description": "Audit inline assets against a Canon (conformal alpha).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "canon_id": {"type": "string"},
                "alpha": {"type": "number"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"name": {"type": "string"}, "content": {"type": "string"}},
                    },
                },
            },
            "required": ["canon_id", "items"],
        },
    },
    {
        "name": "get_findings",
        "description": "Return findings for a completed batch job.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "propose_fix",
        "description": "Synthesize PII-scrubbed surgical rewrite for one finding.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}, "finding_id": {"type": "string"}},
            "required": ["job_id", "finding_id"],
        },
    },
    {
        "name": "verify_passport_qr",
        "description": "Verify a PR1: Base45 Merkle QR passport offline + CRL check.",
        "inputSchema": {
            "type": "object",
            "properties": {"payload": {"type": "string"}},
            "required": ["payload"],
        },
    },
)


class PreranaMcpServer:
    """Tenant-isolated in-process & stdio JSON-RPC 2.0 handler for Prerana AI."""

    def __init__(self) -> None:
        # Per-tenant local canon map used only in standalone stdio mode when no DB session is supplied.
        self._local_canons: dict[str, dict[str, Canon]] = {}

    def catalog_byte_size(self) -> int:
        return len(json.dumps(TOOL_DEFINITIONS, separators=(",", ":")).encode("utf-8"))

    async def _list_canons_scoped(self, *, tenant_id: str, session: Any = None, canon_store: Any = None) -> list[Canon]:
        return await list_tenant_canons(
            tenant_id=tenant_id,
            session=session,
            canon_store=canon_store,
            fallback_canons=self._local_canons.get(tenant_id),
        )

    async def _resolve_canon_scoped(
        self, canon_id: str, *, tenant_id: str, session: Any = None, canon_store: Any = None
    ) -> Canon:
        return await resolve_tenant_canon(
            canon_id,
            tenant_id=tenant_id,
            session=session,
            canon_store=canon_store,
            fallback_canons=self._local_canons.get(tenant_id),
        )

    async def handle_rpc(
        self,
        req: dict[str, Any],
        *,
        tenant_id: str = "default",
        session: Any = None,
        canon_store: Any = None,
    ) -> dict[str, Any]:
        rpc_id = req.get("id")
        method = str(req.get("method") or "")
        raw_params = req.get("params")
        if raw_params is None:
            params: dict[str, Any] = {}
        elif isinstance(raw_params, dict):
            params = raw_params
        else:
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32602, "message": "Invalid params: expected a JSON object"},
            }
        set_erp_tenant(tenant_id)

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {
                    "protocolVersion": SUPPORTED_PROTOCOL_VERSIONS[0],
                    "serverInfo": {"name": "prerana-mcp", "version": "0.1.0"},
                    "capabilities": {"tools": {}},
                },
            }

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {"tools": list(TOOL_DEFINITIONS)},
            }

        if method == "tools/call":
            name = str(params.get("name") or "")
            raw_args = params.get("arguments")
            if raw_args is None:
                args: dict[str, Any] = {}
            elif isinstance(raw_args, dict):
                args = raw_args
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32602, "message": "Invalid tool arguments: expected a JSON object"},
                }
            if name in FORBIDDEN_MUTATION_TOOLS or any(name.startswith(f"{v}_") for v in FORBIDDEN_MUTATION_TOOLS):
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "isError": True,
                        "content": [{"type": "text", "text": f"OWASP LLM06 Guard: tool {name!r} is disabled; human sign-off stays in Review Studio."}],
                    },
                }

            try:
                out = await self._dispatch_tool(
                    name, args, tenant_id=tenant_id, session=session, canon_store=canon_store
                )
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(out, default=str)}],
                        "structuredContent": out,
                    },
                }
            except Exception as exc:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "isError": True,
                        "content": [{"type": "text", "text": f"Tool {name!r} error: {exc}"}],
                    },
                }

        return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": f"Unknown method {method!r}"}}

    async def _dispatch_tool(
        self,
        name: str,
        args: dict[str, Any],
        *,
        tenant_id: str = "default",
        session: Any = None,
        canon_store: Any = None,
    ) -> dict[str, Any]:
        if name == "list_canons":
            canons = await self._list_canons_scoped(tenant_id=tenant_id, session=session, canon_store=canon_store)
            return {
                "canons": [
                    {
                        "id": c.id,
                        "version": c.version,
                        "terms": len(c.terminology),
                        "facts": len(c.facts),
                        "triggers": len(c.trigger_obligations),
                    }
                    for c in canons
                ]
            }

        if name == "get_canon_rules":
            cid = str(args.get("canon_id") or "pramaan-campus-placement")
            c = await self._resolve_canon_scoped(cid, tenant_id=tenant_id, session=session, canon_store=canon_store)
            return {
                "canon_id": c.id,
                "version": c.version,
                "hash": c.hash[:16],
                "terminology": [{"id": t.id, "pattern": t.pattern_text, "preferred": t.preferred, "severity": t.severity} for t in c.terminology],
                "facts": [{"id": f.id, "text": f.text, "metric": f.metric_value} for f in c.facts],
                "triggers": [{"id": tr.id, "required": tr.required_disclaimer_text} for tr in c.trigger_obligations],
            }

        if name == "compile_canon":
            cid = str(args.get("canon_id") or "mcp-custom").strip()[:120]
            raw_text = str(args.get("raw_text") or "")
            if len(raw_text) > 200_000:
                raise ValueError("Policy text exceeds 200,000 character limit")
            if default_canon_registry.is_builtin(cid):
                raise ValueError(f"Built-in canon {cid!r} cannot be overwritten")
            comp = await asyncio.to_thread(compile_canon, canon_id=cid, raw_text=raw_text, version="1.0")
            if session is not None and canon_store is not None:
                await canon_store.save_compiled_canon(
                    session,
                    canon_id=comp.canon.id,
                    yaml_content=canon_to_yaml(comp.canon),
                    tenant_id=tenant_id,
                )
                await session.commit()
            else:
                self._local_canons.setdefault(tenant_id, {})[comp.canon.id] = comp.canon
            return {
                "canon_id": comp.canon.id,
                "grounded_rules_count": comp.grounded_rules_count,
                "rejected_hallucinations": comp.rejected_hallucinations,
                "term_count": len(comp.canon.terminology),
                "fact_count": len(comp.canon.facts),
            }

        if name == "submit_batch":
            cid = str(args.get("canon_id") or "pramaan-campus-placement")
            alpha = float(args.get("alpha", 0.10))
            if not (0.01 <= alpha <= 0.50):
                raise ValueError("alpha must be between 0.01 and 0.50")
            raw_items = args.get("items") or []
            if not isinstance(raw_items, list) or len(raw_items) > 100:
                raise ValueError("items must be a list of at most 100 entries")
            items = [
                (str(it.get("name") or f"item_{i}.md")[:160], str(it.get("content") or "")[:200_000])
                for i, it in enumerate(raw_items)
                if isinstance(it, dict)
            ]
            resolved_canon = await self._resolve_canon_scoped(
                cid, tenant_id=tenant_id, session=session, canon_store=canon_store
            )
            job: BatchJob = await default_batch_runner.run_batch(
                canon_id=resolved_canon.id,
                assets=items,
                alpha=alpha,
                canon=resolved_canon,
                tenant_id=tenant_id,
            )
            return {
                "job_id": job.job_id,
                "status": job.status,
                "elapsed_ms": job.elapsed_ms,
                "items": [
                    {
                        "filename": it.filename,
                        "decision": it.decision,
                        "findings_count": it.findings_count,
                        "blockers_count": it.blockers_count,
                    }
                    for it in job.items
                ],
            }

        if name == "get_findings":
            jid = str(args.get("job_id") or "")
            job = await asyncio.to_thread(default_batch_runner.get_job, jid, tenant_id=tenant_id)
            if not job:
                raise ValueError(f"Unknown batch job_id: {jid!r}")
            return {
                "job_id": job.job_id,
                "items": [
                    {
                        "filename": it.filename,
                        "decision": it.decision,
                        "findings": [f.model_dump(mode="json") for f in it.findings],
                    }
                    for it in job.items
                ],
            }

        if name == "propose_fix":
            jid = str(args.get("job_id") or "")
            fid = str(args.get("finding_id") or "")
            job = await asyncio.to_thread(default_batch_runner.get_job, jid, tenant_id=tenant_id)
            if not job:
                raise ValueError(f"Unknown job_id: {jid!r}")
            canon = await self._resolve_canon_scoped(
                job.canon_id, tenant_id=tenant_id, session=session, canon_store=canon_store
            )
            for it in job.items:
                for f in it.findings:
                    if str(f.id) == fid:
                        txt = getattr(f.evidence, "draft_sentence", "") or getattr(f.evidence, "term", "") or f.message
                        node = TextNode.from_text(txt, path="mcp/span[0]")
                        ast = ContentAST(nodes=(node,))
                        rw = await asyncio.to_thread(
                            rewrite_finding_surgically,
                            ast=ast,
                            node=node,
                            finding=f,
                            canon=canon,
                            verify_fn=run_checks_sync,
                        )
                        return {
                            "finding_id": fid,
                            "rewritten_text": rw.rewritten_text,
                            "reverified": rw.reverified,
                            "used_provider": rw.used_provider,
                            "provider_notice": rw.provider_notice,
                        }
            raise ValueError(f"Finding {fid!r} not found in job {jid!r}")

        if name == "verify_passport_qr":
            payload = str(args.get("payload") or "")
            res = await asyncio.to_thread(verify_selective_passport_with_ring, payload)
            revoked, rev_reason = (
                await asyncio.to_thread(default_erp_oracle().is_passport_revoked, res.passport_id)
                if res.passport_id
                else (False, None)
            )
            return {
                "valid": bool(res.valid and not revoked),
                "revoked": revoked,
                "reason": rev_reason if revoked else res.reason,
                "passport_id": res.passport_id,
                "holder_prn": res.holder_prn,
                "disclosed_claims": res.disclosed_claims,
                "key_id": res.key_id,
            }

        raise ValueError(f"Unknown tool {name!r}")


default_mcp_server = PreranaMcpServer()


def main() -> None:
    """Stdio JSON-RPC 2.0 loop for local MCP clients."""
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        req = json.loads(raw)
        resp = asyncio.run(default_mcp_server.handle_rpc(req))
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

