"""Canon Playbooks, Linter, Compiler, Friction Analytics & v1.1 PR Simulator API Routes.

Built-in statutory canons come read-only from `default_canon_registry`.
Institution-compiled custom canons are stored and resolved per-tenant from the database
so tenants never share or overwrite each other's custom policies across workers.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from pramaan.api.deps import CurrentUser, SessionDep, TeacherOrAdminUser
from pramaan.canon import (
    canon_to_yaml,
    compile_canon,
    default_canon_registry,
    lint_canon,
    list_tenant_canons,
    propose_canon_revision,
    resolve_tenant_canon,
    simulate_canon_impact,
)
from pramaan.domain import Canon, Role
from pramaan.engine import run_checks_sync
from pramaan.ledger import compute_rule_friction
from pramaan.parsers import parse_text
from pramaan.store import repos

router = APIRouter(prefix="/canons", tags=["canons"])


async def resolve_canon_for_tenant(
    session: AsyncSession,
    canon_id: str,
    tenant_id: str,
) -> Canon:
    """Resolve a built-in statutory canon or a tenant-owned custom canon from the DB."""
    return await resolve_tenant_canon(canon_id, tenant_id=tenant_id, session=session, canon_store=repos)


async def list_canons_for_tenant(session: AsyncSession, tenant_id: str) -> list[Canon]:
    return await list_tenant_canons(tenant_id=tenant_id, session=session, canon_store=repos)


class CompileCanonRequest(BaseModel):
    canon_id: str = Field(min_length=2, max_length=120)
    raw_text: str = Field(min_length=5, max_length=200_000)
    version: str = Field(default="1.0", max_length=32)


def _canon_dto(c: Canon) -> dict:
    return {
        "id": c.id,
        "version": c.version,
        "hash": c.hash,
        "term_count": len(c.terminology),
        "color_count": len(c.palette),
        "fact_count": len(c.facts),
        "trigger_count": len(c.trigger_obligations),
        "yaml": canon_to_yaml(c),
        "terminology": [t.model_dump(mode="json") for t in c.terminology],
        "facts": [f.model_dump(mode="json") for f in c.facts],
        "triggers": [tr.model_dump(mode="json") for tr in c.trigger_obligations],
    }


@router.get("")
async def list_canons(session: SessionDep, user: CurrentUser):
    canons = await list_canons_for_tenant(session, user.tenant_id)
    return [_canon_dto(c) for c in canons]


@router.get("/{canon_id}")
async def get_canon_detail(canon_id: str, session: SessionDep, user: CurrentUser):
    try:
        c = await resolve_canon_for_tenant(session, canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _canon_dto(c)


@router.post("/compile", status_code=201)
async def compile_canon_endpoint(req: CompileCanonRequest, session: SessionDep, user: CurrentUser):
    if user.role not in (Role.TEACHER.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Teacher or Admin can compile new Canons")
    cid = req.canon_id.strip()
    if default_canon_registry.is_builtin(cid):
        raise HTTPException(status_code=403, detail=f"Built-in canon {cid!r} cannot be overwritten")
    res = await asyncio.to_thread(
        compile_canon,
        canon_id=cid,
        raw_text=req.raw_text,
        version=req.version,
    )
    await repos.save_compiled_canon(
        session,
        canon_id=res.canon.id,
        yaml_content=canon_to_yaml(res.canon),
        tenant_id=user.tenant_id,
    )
    await session.commit()
    return {
        "canon": _canon_dto(res.canon),
        "grounded_rules_count": res.grounded_rules_count,
        "rejected_hallucinations": res.rejected_hallucinations,
        "warnings": list(res.warnings),
    }


@router.get("/{canon_id}/lint")
async def lint_canon_endpoint(canon_id: str, session: SessionDep, user: CurrentUser):
    try:
        c = await resolve_canon_for_tenant(session, canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    issues = await asyncio.to_thread(lint_canon, c)
    return {
        "canon_id": c.id,
        "canon_version": c.version,
        "is_valid": len(issues) == 0,
        "issues": [{"rule_ids": list(i.rule_ids), "kind": i.kind, "message": i.message} for i in issues],
    }


@router.get("/{canon_id}/friction-pr")
async def canon_friction_and_pr(canon_id: str, session: SessionDep, user: TeacherOrAdminUser):
    try:
        c = await resolve_canon_for_tenant(session, canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    canon_subs = await repos.list_submissions(session, limit=200, tenant_id=user.tenant_id, canon_id=c.id)
    canon_findings = await repos.list_all_findings(session, limit=500, tenant_id=user.tenant_id, canon_id=c.id)
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    for frow in canon_findings:
        payload = json.loads(frow.payload_json)
        rid = str((payload.get("rule") or {}).get("rule_id") or "")
        if not rid:
            continue
        counts[rid][0] += 1
        if frow.resolution in ("dismissed", "overridden"):
            counts[rid][1] += 1

    rule_metrics = []
    friction_tuples: dict[str, tuple[int, int]] = {}
    for rid, (tot, disp) in sorted(counts.items()):
        raw_fr, post_fr = compute_rule_friction(tot, disp)
        friction_tuples[rid] = (tot, disp)
        rule_metrics.append(
            {
                "rule_id": rid,
                "total_flags": tot,
                "overrides": disp,
                "raw_friction": raw_fr,
                "posterior_friction": post_fr,
                "needs_revision": tot >= 3 and post_fr >= 0.40,
            }
        )

    proposal = propose_canon_revision(c, friction_tuples, threshold=0.40, min_flags=3)
    bundles = [parse_text(s.raw_content, source_filename=s.title) for s in canon_subs]
    sim = await asyncio.to_thread(simulate_canon_impact, c, proposal.revised_canon, bundles, run_checks_sync)
    return {
        "canon_id": c.id,
        "base_version": c.version,
        "proposed_version": proposal.revised_canon.version,
        "has_changes": bool(proposal),
        "rule_metrics": rule_metrics,
        "revisions": [
            {
                "rule_id": r.rule_id,
                "posterior_friction": r.posterior_friction,
                "action": r.action,
                "before_summary": r.before_summary,
                "after_summary": r.after_summary,
                "rationale": r.rationale,
            }
            for r in proposal.revisions
        ],
        "yaml_diff": proposal.yaml_diff,
        "impact_simulation": {
            "bundles_evaluated": sim.bundles_evaluated,
            "before_findings": sim.before_findings,
            "after_findings": sim.after_findings,
            "before_blockers": sim.before_blockers,
            "after_blockers": sim.after_blockers,
            "resolved_rule_ids": list(sim.resolved_rule_ids),
        },
    }
