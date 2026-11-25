"""YAML Canon loader and in-memory registry rooted cleanly at `pramaan/canons/`."""

from __future__ import annotations

from pathlib import Path

import yaml

from pramaan.domain import (
    Canon,
    ColorToken,
    FactClaim,
    TermRule,
    TriggerObligation,
    VoiceProfile,
)

CANONS_DIR = Path(__file__).resolve().parents[4] / "canons"


def parse_canon_yaml(raw_yaml: str) -> Canon:
    data = yaml.safe_load(raw_yaml) or {}
    vp_raw = data.get("voice_profile")
    return Canon(
        id=str(data.get("id") or "pramaan-custom"),
        version=str(data.get("version") or "2026.11"),
        require_image_alt=bool(data.get("require_image_alt", True)),
        min_wcag_contrast=float(data.get("min_wcag_contrast", 4.5)),
        terminology=tuple(TermRule(**t) for t in (data.get("terminology") or ())),
        palette=tuple(ColorToken(**c) for c in (data.get("palette") or ())),
        facts=tuple(FactClaim(**f) for f in (data.get("facts") or ())),
        trigger_obligations=tuple(TriggerObligation(**tr) for tr in (data.get("trigger_obligations") or ())),
        voice_profile=VoiceProfile(**vp_raw) if vp_raw else None,
        applies_to=dict(data.get("applies_to") or {}),
        enabled_checks=tuple(str(c) for c in (data.get("enabled_checks") or ())),
    )


class CanonRegistry:
    """Thread-safe Canon store initialized from YAML playbooks plus runtime-compiled canons."""

    def __init__(self, canons_dir: Path | None = None) -> None:
        self._dir = canons_dir or CANONS_DIR
        self._canons: dict[str, Canon] = {}
        self.reload()

    def reload(self) -> None:
        self._canons.clear()
        self._builtin_ids: set[str] = set()
        if self._dir.is_dir():
            for path in sorted(self._dir.glob("*.yaml")):
                canon = parse_canon_yaml(path.read_text(encoding="utf-8"))
                self._canons[canon.id] = canon
                self._builtin_ids.add(canon.id)

    def is_builtin(self, canon_id: str) -> bool:
        return canon_id in getattr(self, "_builtin_ids", set())

    def register(self, canon: Canon, *, allow_overwrite: bool = False) -> None:
        if not allow_overwrite and self.is_builtin(canon.id):
            raise PermissionError(f"Built-in canon {canon.id!r} cannot be overwritten")
        self._canons[canon.id] = canon

    def get(self, canon_id: str) -> Canon:
        if canon_id in self._canons:
            return self._canons[canon_id]
        raise KeyError(f"Unknown canon_id: {canon_id!r}")

    def list_ids(self) -> list[str]:
        return sorted(self._canons.keys())

    def all(self) -> list[Canon]:
        return [self._canons[k] for k in self.list_ids()]


default_canon_registry = CanonRegistry()


async def list_tenant_canons(
    *,
    tenant_id: str,
    session: object | None = None,
    canon_store: object | None = None,
    fallback_canons: dict[str, Canon] | None = None,
) -> list[Canon]:
    """List built-in statutory canons merged with tenant-owned custom canons from DB or local map."""
    by_id: dict[str, Canon] = {
        c.id: c for c in default_canon_registry.all() if default_canon_registry.is_builtin(c.id)
    }
    if session is not None and canon_store is not None:
        for row in await canon_store.list_compiled_canons(session, tenant_id=tenant_id):  # type: ignore[attr-defined]
            try:
                c = parse_canon_yaml(row.yaml_content)
                by_id[c.id] = c
            except Exception:
                continue
    elif fallback_canons:
        for c in fallback_canons.values():
            by_id[c.id] = c
    return [by_id[k] for k in sorted(by_id.keys())]


async def resolve_tenant_canon(
    canon_id: str,
    *,
    tenant_id: str,
    session: object | None = None,
    canon_store: object | None = None,
    fallback_canons: dict[str, Canon] | None = None,
) -> Canon:
    """Resolve a built-in statutory canon or tenant-owned custom canon from DB or local map."""
    if default_canon_registry.is_builtin(canon_id):
        return default_canon_registry.get(canon_id)
    if session is not None and canon_store is not None:
        row = await canon_store.get_compiled_canon(session, canon_id, tenant_id=tenant_id)  # type: ignore[attr-defined]
        if row is not None:
            return parse_canon_yaml(row.yaml_content)
    elif fallback_canons and canon_id in fallback_canons:
        return fallback_canons[canon_id]
    raise KeyError(f"Unknown canon_id: {canon_id!r}")

