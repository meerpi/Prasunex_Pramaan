"""Pre-Publish Webhook Gate (`POST /api/gate/check`) & Prerana AI Streamable HTTP MCP Endpoint (`/api/mcp`)."""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from pramaan.api.deps import (
    SESSION_COOKIE_NAME,
    CurrentUser,
    SessionDep,
    get_current_user,
    is_trusted_origin,
)
from pramaan.api.routes.canons import resolve_canon_for_tenant
from pramaan.domain import Role
from pramaan.engine import default_calibrator, run_checks_collect
from pramaan.mcp import SUPPORTED_PROTOCOL_VERSIONS, default_mcp_server
from pramaan.parsers import parse_text
from pramaan.store import repos

router = APIRouter(tags=["gate", "mcp"])


class WebhookGateRequest(BaseModel):
    canon_id: str = Field(default="pramaan-campus-placement", min_length=1, max_length=128)
    title: str = Field(default="Campus Webhook Check", max_length=256)
    raw_content: str = Field(min_length=1, max_length=200_000)
    alpha: float = Field(default=0.10, ge=0.01, le=0.50)


@router.post("/gate/check")
async def pre_publish_gate_check(req: WebhookGateRequest, session: SessionDep, user: CurrentUser):
    t0 = time.perf_counter()
    try:
        canon = await resolve_canon_for_tenant(session, req.canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ast = parse_text(req.raw_content, source_filename=req.title)
    raw = await run_checks_collect(ast, canon)
    cal = default_calibrator.filter_and_calibrate_findings(raw, alpha=req.alpha)
    blockers = sum(1 for f in cal if f.severity >= 50)
    warnings = len(cal) - blockers
    decision = "block" if blockers > 0 else ("needs_review" if warnings > 0 else "allow")
    return {
        "decision": decision,
        "canon_id": canon.id,
        "alpha": req.alpha,
        "blockers_count": blockers,
        "warnings_count": warnings,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "findings": [f.model_dump(mode="json") for f in cal],
    }


@router.post("/mcp")
async def mcp_streamable_http(request: Request, session: SessionDep):
    origin = request.headers.get("origin")
    if not is_trusted_origin(origin, request=request):
        raise HTTPException(status_code=403, detail=f"Untrusted MCP Origin {origin!r} rejected (DNS-rebinding protection)")

    user = await get_current_user(
        request,
        session,
        request.headers.get("authorization"),
        request.cookies.get(SESSION_COOKIE_NAME),
    )

    proto = request.headers.get("mcp-protocol-version")
    if proto and proto not in SUPPORTED_PROTOCOL_VERSIONS:
        return JSONResponse(
            status_code=400,
            content={
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32020, "message": f"HeaderMismatch: unsupported MCP-Protocol-Version {proto!r}"},
            },
        )
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON-RPC payload") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON-RPC request must be a JSON object")
    params = body.get("params")
    if params is not None and not isinstance(params, dict):
        raise HTTPException(status_code=400, detail="JSON-RPC 'params' must be a JSON object")
    if (
        body.get("method") == "tools/call"
        and isinstance(params, dict)
        and params.get("name") == "compile_canon"
        and user.role not in (Role.TEACHER.value, Role.ADMIN.value)
    ):
        raise HTTPException(status_code=403, detail="Only Teacher or Admin can compile Canons via MCP")
    resp = await default_mcp_server.handle_rpc(
        body, tenant_id=user.tenant_id, session=session, canon_store=repos
    )
    return JSONResponse(status_code=200, content=resp)


@router.get("/mcp")
@router.delete("/mcp")
async def mcp_method_not_allowed():
    raise HTTPException(status_code=405, detail="Streamable HTTP MCP expects POST /api/mcp")
