"""Governance Submission CRUD, SSE Conformal Scans, Revisions, Surgical Rewrites, Workflow FSM & Hash Chain."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sse_starlette.sse import EventSourceResponse

from pramaan.api.deps import AuthorUser, CurrentUser, SessionDep, TeacherOrAdminUser
from pramaan.api.routes.canons import resolve_canon_for_tenant
from pramaan.domain import (
    Action,
    Finding,
    Role,
    Status,
    TextNode,
    content_hash,
    transition_submission,
)
from pramaan.engine import (
    default_calibrator,
    rewrite_finding_surgically,
    run_checks_collect,
    run_checks_stream,
    run_checks_sync,
)
from pramaan.ledger import (
    build_signed_governance_manifest,
    load_signing_key_ring,
    verify_chain,
)
from pramaan.parsers import default_bundle_parser, parse_text
from pramaan.store import SubmissionRow, async_session, repos

router = APIRouter(prefix="/submissions", tags=["submissions"])


class AttachmentDto(BaseModel):
    filename: str = Field(min_length=1, max_length=256)
    content_base64: str = Field(max_length=14_000_000)


class CreateSubmissionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    raw_content: str = Field(default="", max_length=200_000)
    canon_id: str = Field(default="pramaan-campus-placement", max_length=128)
    portal_scope: str = Field(default="student", max_length=32)
    attachments: list[AttachmentDto] = Field(default_factory=list, max_length=5)


class UpdateContentRequest(BaseModel):
    raw_content: str = Field(max_length=200_000)
    change_note: str = Field(default="Edited in Review Studio", max_length=256)
    alpha: float = Field(default=0.10, ge=0.01, le=0.50)
    skip_scan: bool = False


class ResolveFindingRequest(BaseModel):
    resolution: str = Field(max_length=32)  # accepted | dismissed | overridden
    apply_suggestion: bool = True
    reason: str = Field(default="", max_length=1000)


class WorkflowRequest(BaseModel):
    action: str = Field(max_length=32)
    comment: str = Field(default="", max_length=2000)


class CommentRequest(BaseModel):
    finding_id: int | None = None
    body: str = Field(min_length=1, max_length=4000)


def can_user_access_submission(user, sub: SubmissionRow) -> bool:
    """Enforce strict multi-tenant, account & portal lifecycle isolation."""
    if sub.tenant_id != user.tenant_id:
        return False
    if sub.creator_id == user.id:
        return True
    if user.role in (Role.TEACHER.value, Role.ADMIN.value):
        return sub.status in (
            Status.IN_REVIEW.value,
            Status.APPROVED.value,
            Status.PUBLISHED.value,
        )
    if user.role in (Role.PARENT.value, Role.RECRUITER.value):
        return sub.status in (Status.APPROVED.value, Status.PUBLISHED.value)
    return False


def _serialize_submission(sub: SubmissionRow, *, include_ast: bool = True) -> dict[str, Any]:
    txt_nodes: list[TextNode] = []
    if include_ast:
        ast = parse_text(sub.raw_content)
        txt_nodes = [n for n in ast.nodes if isinstance(n, TextNode)]
    return {
        "id": sub.id,
        "title": sub.title,
        "status": sub.status,
        "portal_scope": sub.portal_scope,
        "content_hash": sub.content_hash,
        "canon_id": sub.canon_id,
        "canon_hash": sub.canon_hash,
        "creator_id": sub.creator_id,
        "raw_content": sub.raw_content if include_ast else "",
        "paragraph_node_ids": [n.id for n in txt_nodes],
        "text_blocks": [n.text for n in txt_nodes],
        "image_nodes": [],
        "c2pa_manifest": json.loads(sub.c2pa_manifest_json) if sub.c2pa_manifest_json else None,
        "created_at": sub.created_at.isoformat(),
        "updated_at": sub.updated_at.isoformat(),
    }


_MAX_ATTACHMENTS = 5
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


def _ingest_attachments(raw_content: str, attachments: list[AttachmentDto]) -> str:
    if len(attachments) > _MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"Too many attachments (max {_MAX_ATTACHMENTS})")
    blocks: list[str] = [raw_content.strip()] if raw_content.strip() else []
    parser = default_bundle_parser
    for att in attachments:
        try:
            raw_b = base64.b64decode(att.content_base64, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid base64 encoding for {att.filename!r}") from exc
        if len(raw_b) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail=f"Attachment {att.filename!r} exceeds 10 MB limit")
        safe_name = Path(att.filename).name
        parsed_ast = parser.parse_one((safe_name, raw_b))
        for n in parsed_ast.nodes:
            if isinstance(n, TextNode) and n.text.strip():
                if n.is_hidden or n.path.startswith("pdf/anomaly["):
                    blocks.append(f"[HIDDEN_ANOMALY] {n.text.strip()}")
                else:
                    blocks.append(n.text.strip())
    return "\n\n".join(blocks)


@router.get("")
async def list_submissions(session: SessionDep, user: CurrentUser):
    rows = await repos.list_submissions(session, limit=200, tenant_id=user.tenant_id)
    visible = [r for r in rows if can_user_access_submission(user, r)]
    return [_serialize_submission(r, include_ast=False) for r in visible]


@router.post("", status_code=201)
async def create_submission(req: CreateSubmissionRequest, session: SessionDep, user: AuthorUser):
    try:
        canon = await resolve_canon_for_tenant(session, req.canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        merged = await asyncio.to_thread(_ingest_attachments, req.raw_content, req.attachments)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    c_hash = content_hash(merged.encode("utf-8"))
    sub = await repos.create_submission(
        session,
        title=req.title.strip() or "Untitled Draft",
        raw_content=merged,
        content_hash=c_hash,
        canon_id=canon.id,
        canon_hash=canon.hash,
        creator_id=user.id,
        portal_scope=req.portal_scope or user.role,
        tenant_id=user.tenant_id,
    )
    ast = parse_text(sub.raw_content, source_filename=sub.title)
    findings = default_calibrator.filter_and_calibrate_findings(
        await run_checks_collect(ast, canon), alpha=0.10
    )
    await repos.save_findings(session, sub.id, findings, tenant_id=user.tenant_id)
    await session.commit()
    return _serialize_submission(sub)


@router.get("/audit-chain")
async def get_audit_chain(session: SessionDep, user: TeacherOrAdminUser):
    rows = await repos.list_workflow_events(session, tenant_id=user.tenant_id)
    events = repos.to_audit_chain_events(rows)
    ok, broken_idx = verify_chain(events)
    return {
        "valid": ok,
        "broken_index": broken_idx,
        "count": len(rows),
        "events": [
            {
                "id": r.id,
                "submission_id": r.submission_id,
                "action": r.action,
                "actor_id": r.actor_id,
                "actor_name": r.actor_name,
                "comment": r.comment,
                "prev_hash": r.prev_hash,
                "event_hash": r.event_hash,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/{submission_id}")
async def get_submission(submission_id: int, session: SessionDep, user: CurrentUser):
    sub = await repos.get_submission(session, submission_id)
    if not sub or sub.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not can_user_access_submission(user, sub):
        raise HTTPException(status_code=403, detail="Access denied for current role/lifecycle")
    return _serialize_submission(sub)


@router.put("/{submission_id}/content")
async def update_content(
    submission_id: int,
    req: UpdateContentRequest,
    session: SessionDep,
    user: CurrentUser,
):
    sub = await repos.get_submission(session, submission_id)
    if not sub or sub.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.creator_id != user.id and user.role not in (Role.TEACHER.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Not permitted to edit this submission")
    if sub.status not in (Status.DRAFT.value, Status.CHANGES_REQUESTED.value):
        raise HTTPException(status_code=409, detail=f"Cannot edit in {sub.status!r} status")

    new_c_hash = content_hash(req.raw_content.encode("utf-8"))
    sub = await repos.update_submission_content(
        session,
        submission_id,
        raw_content=req.raw_content,
        content_hash=new_c_hash,
        actor_id=user.id,
        change_note=req.change_note,
    )
    assert sub is not None
    sub.c2pa_manifest_json = ""
    if not req.skip_scan:
        try:
            canon = await resolve_canon_for_tenant(session, sub.canon_id, user.tenant_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        ast = parse_text(sub.raw_content, source_filename=sub.title)
        findings = default_calibrator.filter_and_calibrate_findings(
            await run_checks_collect(ast, canon), alpha=req.alpha
        )
        await repos.save_findings(session, submission_id, findings, tenant_id=user.tenant_id)
    await session.commit()
    return _serialize_submission(sub)


@router.post("/{submission_id}/scan")
async def scan_submission(
    submission_id: int,
    session: SessionDep,
    user: CurrentUser,
    alpha: Annotated[float, Query(ge=0.01, le=0.50)] = 0.10,
):
    sub = await repos.get_submission(session, submission_id)
    if not sub or sub.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not can_user_access_submission(user, sub):
        raise HTTPException(status_code=403, detail="Access denied")
    if sub.status in (Status.APPROVED.value, Status.PUBLISHED.value):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot re-scan or mutate findings once submission is {sub.status!r}",
        )
    is_reviewer = user.role in (Role.TEACHER.value, Role.ADMIN.value)
    if not is_reviewer and (sub.creator_id != user.id or sub.status not in (Status.DRAFT.value, Status.CHANGES_REQUESTED.value)):
        raise HTTPException(status_code=403, detail="Not permitted to re-scan this submission in its current state")
    try:
        canon = await resolve_canon_for_tenant(session, sub.canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ast = parse_text(sub.raw_content, source_filename=sub.title)
    cutoff = default_calibrator.threshold(alpha)

    async def event_gen() -> AsyncIterator[dict[str, str]]:
        stage_labels = {
            "tier_1_deterministic": "Checking statutory ordinance rules",
            "tier_1_5_smt": "Running Z3 formal constraint solver",
            "tier_2_nli": "Cross-checking evidence claims",
        }
        emitted_stages: set[str] = set()
        yield {
            "event": "stage",
            "data": json.dumps({"stage": "parse", "label": "Parsing draft paragraphs"}),
        }
        collected: list[Finding] = []
        async for f in run_checks_stream(ast, canon):
            batch = default_calibrator.filter_and_calibrate_findings([f], alpha=alpha)
            for cf in batch:
                tier = cf.trace.tier
                if tier not in emitted_stages:
                    emitted_stages.add(tier)
                    yield {
                        "event": "stage",
                        "data": json.dumps(
                            {
                                "stage": tier,
                                "label": stage_labels.get(tier, "Running verification checks"),
                            }
                        ),
                    }
                collected.append(cf)
                yield {"event": "finding", "data": cf.model_dump_json()}
        yield {
            "event": "stage",
            "data": json.dumps({"stage": "conformal", "label": "Calibrating conformal risk score"}),
        }
        skipped_immutable = False
        async with async_session(tenant_id=user.tenant_id) as psess:
            cur_sub = await repos.get_submission(psess, submission_id)
            if (
                cur_sub is None
                or cur_sub.tenant_id != user.tenant_id
                or cur_sub.status in (Status.APPROVED.value, Status.PUBLISHED.value)
            ):
                skipped_immutable = True
            else:
                await repos.save_findings(psess, submission_id, collected, tenant_id=user.tenant_id)
                await psess.commit()
        yield {
            "event": "done",
            "data": json.dumps(
                {
                    "total": len(collected),
                    "alpha": alpha,
                    "conformal_threshold": cutoff,
                    **({"skipped_immutable": True} if skipped_immutable else {}),
                }
            ),
        }

    return EventSourceResponse(event_gen())


@router.get("/{submission_id}/findings")
async def get_findings(submission_id: int, session: SessionDep, user: CurrentUser):
    sub = await repos.get_submission(session, submission_id)
    if not sub or not can_user_access_submission(user, sub):
        raise HTTPException(status_code=404, detail="Submission not found or inaccessible")
    rows = await repos.list_findings(session, submission_id)
    return [
        {
            "row_id": r.id,
            "finding_id": r.finding_id,
            "check_id": r.check_id,
            "node_id": r.node_id,
            "severity": r.severity,
            "message": r.message,
            "resolution": r.resolution,
            "resolution_reason": r.resolution_reason,
            "payload": json.loads(r.payload_json),
        }
        for r in rows
    ]


@router.post("/{submission_id}/findings/{finding_row_id}/resolve")
async def resolve_finding(
    submission_id: int,
    finding_row_id: int,
    req: ResolveFindingRequest,
    session: SessionDep,
    user: CurrentUser,
):
    row = await repos.get_finding_by_row_id(session, finding_row_id)
    if not row or row.submission_id != submission_id or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Finding not found")
    sub = await repos.get_submission(session, submission_id)
    if not sub or sub.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not can_user_access_submission(user, sub):
        raise HTTPException(status_code=403, detail="Access denied")
    if req.resolution not in ("accepted", "dismissed", "overridden"):
        raise HTTPException(status_code=400, detail="Invalid resolution value")
    if sub.status in (Status.APPROVED.value, Status.PUBLISHED.value):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot resolve or mutate findings once submission is {sub.status!r}",
        )
    is_reviewer = user.role in (Role.TEACHER.value, Role.ADMIN.value)
    if req.resolution in ("dismissed", "overridden") and not is_reviewer:
        raise HTTPException(
            status_code=403,
            detail="Only Teacher or Admin reviewers may dismiss or override compliance findings",
        )
    if req.resolution == "accepted":
        if sub.creator_id != user.id and not is_reviewer:
            raise HTTPException(status_code=403, detail="Not permitted to accept findings on this submission")
        if req.apply_suggestion and sub.status not in (Status.DRAFT.value, Status.CHANGES_REQUESTED.value):
            raise HTTPException(status_code=409, detail=f"Cannot modify text in {sub.status!r} status")

    payload = json.loads(row.payload_json)
    patch = (payload.get("suggestion") or {}).get("patch")
    new_raw: str | None = None
    if req.resolution == "accepted" and req.apply_suggestion and patch and patch.get("kind") == "replace":
        ast = parse_text(sub.raw_content, source_filename=sub.title)
        updated_blocks: list[str] = []
        changed = False
        for n in ast.nodes:
            if isinstance(n, TextNode):
                if n.id == row.node_id:
                    s, e = int(patch["start"]), int(patch["end"])
                    if 0 <= s <= e <= len(n.text):
                        updated_blocks.append(n.text[:s] + str(patch["new_text"]) + n.text[e:])
                        changed = True
                        continue
                updated_blocks.append(n.text)
        if not changed:
            raise HTTPException(
                status_code=409,
                detail="Paragraph changed since last scan; re-scan before applying suggested edit",
            )
        new_raw = "\n\n".join(updated_blocks)

    row.resolution = req.resolution
    row.resolution_reason = req.reason.strip()
    row.resolved_by = user.id

    if new_raw is not None:
        await repos.update_submission_content(
            session,
            submission_id,
            raw_content=new_raw,
            content_hash=content_hash(new_raw.encode("utf-8")),
            actor_id=user.id,
            change_note=f"Applied suggested fix for finding #{row.id}",
        )
    await session.commit()
    return {"row_id": row.id, "resolution": row.resolution}


@router.post("/{submission_id}/findings/{finding_row_id}/rewrite")
async def rewrite_finding(
    submission_id: int,
    finding_row_id: int,
    session: SessionDep,
    user: CurrentUser,
):
    sub = await repos.get_submission(session, submission_id)
    row = await repos.get_finding_by_row_id(session, finding_row_id)
    if not sub or not row or row.submission_id != submission_id or sub.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Finding or submission not found")
    if not can_user_access_submission(user, sub):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role not in (Role.TEACHER.value, Role.ADMIN.value) and sub.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Not permitted to rewrite findings on this submission")
    if sub.status in (Status.APPROVED.value, Status.PUBLISHED.value):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot rewrite findings once submission is {sub.status!r}",
        )

    try:
        canon = await resolve_canon_for_tenant(session, sub.canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ast = parse_text(sub.raw_content, source_filename=sub.title)
    text_nodes = [n for n in ast.nodes if isinstance(n, TextNode)]
    node = next((n for n in text_nodes if n.id == row.node_id), text_nodes[0] if text_nodes else TextNode.from_text(sub.raw_content))
    finding_obj = Finding.model_validate_json(row.payload_json)
    rw = await asyncio.to_thread(
        rewrite_finding_surgically,
        ast=ast,
        node=node,
        finding=finding_obj,
        canon=canon,
        verify_fn=run_checks_sync,
    )
    return {
        "row_id": row.id,
        "finding_id": row.finding_id,
        "original_text": rw.original_text,
        "rewritten_text": rw.rewritten_text,
        "masked_prompt_preview": rw.masked_prompt_preview,
        "edit_distance_ratio": rw.edit_distance_ratio,
        "max_edit_distance_ratio": rw.max_edit_distance_ratio,
        "reverified": rw.reverified,
        "remaining_findings_count": rw.remaining_findings_count,
        "pii_masked_count": rw.pii_masked_count,
        "used_provider": rw.used_provider,
        "api_key_configured": rw.api_key_configured,
        "provider_notice": rw.provider_notice,
        "quality_gates": rw.quality_gates,
    }


@router.post("/{submission_id}/workflow")
async def workflow_action(
    submission_id: int,
    req: WorkflowRequest,
    session: SessionDep,
    user: CurrentUser,
):
    async with repos._WF_CHAIN_LOCK:
        sub = await repos.get_submission(session, submission_id)
        if not sub or sub.tenant_id != user.tenant_id:
            raise HTTPException(status_code=404, detail="Submission not found")
        if not can_user_access_submission(user, sub):
            raise HTTPException(status_code=403, detail="Access denied")
        if user.role == Role.STUDENT.value and sub.creator_id != user.id:
            raise HTTPException(status_code=403, detail="Students may manage workflow only for their own submissions")
        findings = await repos.list_findings(session, submission_id)
        unresolved_blockers = any(f.severity >= 50 and f.resolution == "open" for f in findings)
        prev_status = sub.status
        try:
            next_status = transition_submission(
                Status(prev_status),
                Action(req.action),
                Role(user.role),
                has_unresolved_blockers=unresolved_blockers,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        updated = await repos.cas_submission_status(
            session,
            submission_id=submission_id,
            tenant_id=user.tenant_id,
            expected_status=prev_status,
            next_status=next_status.value,
        )
        if not updated:
            await session.rollback()
            raise HTTPException(status_code=409, detail="Submission state changed concurrently; refresh and retry.")
        sub.status = next_status.value

        try:
            ev_row = await repos.append_workflow_event(
                session,
                submission_id=submission_id,
                action=req.action,
                actor=user,
                comment=req.comment.strip(),
                lock_held=True,
            )
            manifest = None
            if next_status in (Status.APPROVED, Status.PUBLISHED):
                ring = await asyncio.to_thread(load_signing_key_ring)
                manifest = (
                    await asyncio.to_thread(
                        build_signed_governance_manifest,
                        submission_id=sub.id,
                        content_hash=sub.content_hash,
                        canon_id=sub.canon_id,
                        canon_hash=sub.canon_hash,
                        issuer=user.display_name,
                        tip_hash=ev_row.event_hash,
                        chain_verified=True,
                        signing_key=ring.active.ec_p256_private,
                        key_id=ring.active.ec_kid,
                    )
                ).model_dump()
                sub.c2pa_manifest_json = json.dumps(manifest)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail="Concurrent audit ledger write conflict; retry.") from exc
    return {
        "submission_id": sub.id,
        "status": sub.status,
        "event_hash": ev_row.event_hash,
        "c2pa_manifest": manifest,
    }


@router.get("/{submission_id}/versions")
async def get_versions(submission_id: int, session: SessionDep, user: CurrentUser):
    sub = await repos.get_submission(session, submission_id)
    if not sub or not can_user_access_submission(user, sub):
        raise HTTPException(status_code=404, detail="Submission not found")
    rows = await repos.list_versions(session, submission_id)
    return [
        {
            "version_number": r.version_number,
            "content_hash": r.content_hash,
            "canon_hash": r.canon_hash,
            "raw_content": r.raw_content,
            "change_note": r.change_note,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/{submission_id}/comments")
async def get_comments(submission_id: int, session: SessionDep, user: CurrentUser):
    sub = await repos.get_submission(session, submission_id)
    if not sub or not can_user_access_submission(user, sub):
        raise HTTPException(status_code=404, detail="Submission not found")
    rows = await repos.list_comments(session, submission_id)
    return [
        {
            "id": r.id,
            "submission_id": r.submission_id,
            "finding_id": r.finding_id,
            "author_name": r.author_name,
            "role": r.role,
            "body": r.body,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/{submission_id}/comments", status_code=201)
async def create_comment(submission_id: int, req: CommentRequest, session: SessionDep, user: CurrentUser):
    sub = await repos.get_submission(session, submission_id)
    if not sub or not can_user_access_submission(user, sub):
        raise HTTPException(status_code=404, detail="Submission not found")
    row = await repos.add_comment(
        session, submission_id=submission_id, finding_id=req.finding_id, author=user, body=req.body.strip()
    )
    await session.commit()
    return {
        "id": row.id,
        "submission_id": row.submission_id,
        "finding_id": row.finding_id,
        "author_name": row.author_name,
        "role": row.role,
        "body": row.body,
        "created_at": row.created_at.isoformat(),
    }
