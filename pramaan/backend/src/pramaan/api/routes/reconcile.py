"""Complete-Linkage Multi-Document Claim Graph Reconciliation API Routes."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pramaan.api.deps import SessionDep, TeacherOrAdminUser
from pramaan.engine import ExtractedFact, build_complete_linkage_claim_graph
from pramaan.store import repos

router = APIRouter(prefix="/reconcile", tags=["reconcile"])


class ReconcileRequest(BaseModel):
    doc_ids: list[str] | None = Field(default=None, max_length=50)
    extra_facts: list[ExtractedFact] | None = Field(default=None, max_length=500)


@router.post("/run")
async def run_reconciliation(
    req: ReconcileRequest,
    session: SessionDep,
    user: TeacherOrAdminUser,
):
    docs = await repos.list_stored_documents(session, tenant_id=user.tenant_id)
    if req.doc_ids:
        id_set = set(req.doc_ids)
        docs = [d for d in docs if d.doc_id in id_set]

    facts: list[ExtractedFact] = []
    for d in docs:
        for raw_f in json.loads(d.facts_json):
            facts.append(ExtractedFact.model_validate(raw_f))
    if req.extra_facts:
        facts.extend(req.extra_facts)

    if not facts and not req.doc_ids:
        prev_row = await repos.get_latest_claim_graph(session, tenant_id=user.tenant_id)
        if prev_row is not None:
            prev_payload = json.loads(prev_row.payload_json)
            for cluster in prev_payload.get("clusters", []):
                for raw_f in cluster.get("facts", []):
                    facts.append(ExtractedFact.model_validate(raw_f))

    if not facts:
        raise HTTPException(status_code=400, detail="No extracted or supplied facts available to reconcile")

    graph = await asyncio.to_thread(build_complete_linkage_claim_graph, facts)
    await repos.save_claim_graph(session, graph.graph_id, graph.model_dump_json(), tenant_id=user.tenant_id)
    await session.commit()
    return graph.model_dump()


@router.get("/latest")
async def get_latest_reconciliation(session: SessionDep, user: TeacherOrAdminUser):
    row = await repos.get_latest_claim_graph(session, tenant_id=user.tenant_id)
    if not row:
        return None
    return json.loads(row.payload_json)

