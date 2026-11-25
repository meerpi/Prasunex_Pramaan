"""Async repositories for Pramaan governance state, audit ledger, and PDF evidence."""

from __future__ import annotations

import asyncio
import datetime as dt
import json

from sqlalchemy import delete, desc, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from pramaan.domain import Finding
from pramaan.ledger import GENESIS_HASH, AuditChainEvent, compute_event_hash
from pramaan.store.migrations import run_migrations
from pramaan.store.tables import (
    ClaimGraphRow,
    CompiledCanonRow,
    FindingRow,
    StoredDocumentRow,
    SubmissionCommentRow,
    SubmissionRow,
    SubmissionVersionRow,
    UserRow,
    WorkflowEventRow,
)


async def init_db(engine) -> None:
    await run_migrations(engine)


async def count_users(session: AsyncSession) -> int:
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        try:
            async with session.begin_nested():
                total = await session.scalar(text("SELECT pramaan_auth_count_users()"))
                return int(total or 0)
        except Exception:
            pass
    total = await session.scalar(select(func.count(UserRow.id)))
    return int(total or 0)


async def list_distinct_tenants(session: AsyncSession, *, limit: int = 2) -> list[str]:
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        try:
            async with session.begin_nested():
                res = await session.execute(
                    text("SELECT tenant_id FROM pramaan_auth_distinct_tenants(:lim)"),
                    {"lim": limit},
                )
                return [str(r[0]) for r in res.fetchall()]
        except Exception:
            pass
    res = await session.execute(select(UserRow.tenant_id).distinct().limit(limit))
    return list(res.scalars().all())


async def list_users(session: AsyncSession, *, tenant_id: str) -> list[UserRow]:
    res = await session.execute(
        select(UserRow).where(UserRow.tenant_id == tenant_id).order_by(UserRow.id)
    )
    return list(res.scalars().all())


async def get_users_by_username(
    session: AsyncSession,
    username: str,
    *,
    tenant_id: str | None = None,
) -> list[UserRow]:
    if tenant_id is None:
        bind = session.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            try:
                async with session.begin_nested():
                    res = await session.execute(
                        text(
                            "SELECT id, tenant_id, username, display_name, role, password_hash, "
                            "linked_prn, linked_faculty_id, created_at "
                            "FROM pramaan_auth_lookup_users(:uname) ORDER BY id"
                        ),
                        {"uname": username},
                    )
                    return [
                        UserRow(
                            id=r[0],
                            tenant_id=r[1],
                            username=r[2],
                            display_name=r[3],
                            role=r[4],
                            password_hash=r[5],
                            linked_prn=r[6],
                            linked_faculty_id=r[7],
                            created_at=r[8],
                        )
                        for r in res.fetchall()
                    ]
            except Exception:
                pass
    stmt = select(UserRow).where(UserRow.username == username)
    if tenant_id is not None:
        stmt = stmt.where(UserRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(UserRow.id))
    return list(res.scalars().all())


async def get_user_by_id(session: AsyncSession, user_id: int) -> UserRow | None:
    res = await session.execute(select(UserRow).where(UserRow.id == user_id))
    return res.scalar_one_or_none()


async def create_user(
    session: AsyncSession,
    *,
    username: str,
    display_name: str,
    role: str,
    password_hash: str,
    linked_prn: str = "",
    linked_faculty_id: str = "",
    tenant_id: str = "default",
) -> UserRow:
    row = UserRow(
        tenant_id=tenant_id,
        username=username,
        display_name=display_name,
        role=role,
        password_hash=password_hash,
        linked_prn=linked_prn,
        linked_faculty_id=linked_faculty_id,
    )
    session.add(row)
    await session.flush()
    return row


async def create_submission(
    session: AsyncSession,
    *,
    title: str,
    raw_content: str,
    content_hash: str,
    canon_id: str,
    canon_hash: str,
    creator_id: int,
    portal_scope: str = "student",
    status: str = "draft",
    tenant_id: str = "default",
) -> SubmissionRow:
    sub = SubmissionRow(
        tenant_id=tenant_id,
        title=title,
        raw_content=raw_content,
        content_hash=content_hash,
        canon_id=canon_id,
        canon_hash=canon_hash,
        creator_id=creator_id,
        portal_scope=portal_scope,
        status=status,
    )
    session.add(sub)
    await session.flush()
    ver = SubmissionVersionRow(
        tenant_id=tenant_id,
        submission_id=sub.id,
        version_number=1,
        raw_content=raw_content,
        content_hash=content_hash,
        canon_hash=canon_hash,
        created_by=creator_id,
        change_note="Initial draft",
    )
    session.add(ver)
    await session.flush()
    return sub


async def list_submissions(
    session: AsyncSession,
    *,
    limit: int = 100,
    tenant_id: str | None = None,
    canon_id: str | None = None,
) -> list[SubmissionRow]:
    stmt = select(SubmissionRow)
    if tenant_id is not None:
        stmt = stmt.where(SubmissionRow.tenant_id == tenant_id)
    if canon_id is not None:
        stmt = stmt.where(SubmissionRow.canon_id == canon_id)
    stmt = stmt.order_by(desc(SubmissionRow.updated_at), desc(SubmissionRow.id)).limit(limit)
    res = await session.execute(stmt)
    return list(res.scalars().all())


async def get_submission(session: AsyncSession, submission_id: int) -> SubmissionRow | None:
    res = await session.execute(select(SubmissionRow).where(SubmissionRow.id == submission_id))
    return res.scalar_one_or_none()


async def cas_submission_status(
    session: AsyncSession,
    *,
    submission_id: int,
    tenant_id: str,
    expected_status: str,
    next_status: str,
) -> bool:
    """Compare-and-swap submission status atomically to reject concurrent double transitions."""
    res = await session.execute(
        update(SubmissionRow)
        .where(
            SubmissionRow.id == submission_id,
            SubmissionRow.tenant_id == tenant_id,
            SubmissionRow.status == expected_status,
        )
        .values(status=next_status, updated_at=dt.datetime.now(dt.UTC))
    )
    return int(res.rowcount or 0) == 1


async def update_submission_content(
    session: AsyncSession,
    submission_id: int,
    *,
    raw_content: str,
    content_hash: str,
    actor_id: int,
    change_note: str,
) -> SubmissionRow | None:
    sub = await get_submission(session, submission_id)
    if not sub:
        return None
    sub.raw_content = raw_content
    sub.content_hash = content_hash
    sub.updated_at = dt.datetime.now(dt.UTC)
    max_v = await session.scalar(
        select(func.max(SubmissionVersionRow.version_number)).where(SubmissionVersionRow.submission_id == submission_id)
    )
    ver = SubmissionVersionRow(
        tenant_id=sub.tenant_id,
        submission_id=submission_id,
        version_number=int(max_v or 0) + 1,
        raw_content=raw_content,
        content_hash=content_hash,
        canon_hash=sub.canon_hash,
        created_by=actor_id,
        change_note=change_note,
    )
    session.add(ver)
    await session.flush()
    return sub


_WF_CHAIN_LOCK = asyncio.Lock()


async def save_findings(
    session: AsyncSession,
    submission_id: int,
    findings: list[Finding],
    *,
    tenant_id: str | None = None,
) -> None:
    if tenant_id is None:
        sub = await get_submission(session, submission_id)
        tenant_id = sub.tenant_id if sub else "default"
    existing = await list_findings(session, submission_id)
    prev_resolutions: dict[tuple[str, str, str], tuple[str, str, int | None]] = {}
    for row in existing:
        if row.resolution == "open":
            continue
        rid = str((json.loads(row.payload_json).get("rule") or {}).get("rule_id") or "")
        prev_resolutions[(row.check_id, row.node_id, rid)] = (
            row.resolution,
            row.resolution_reason,
            row.resolved_by,
        )

    await session.execute(delete(FindingRow).where(FindingRow.submission_id == submission_id))
    for f in findings:
        key = (f.check_id, f.node_id, f.rule.rule_id)
        res_state, res_reason, res_by = prev_resolutions.get(key, ("open", "", None))
        session.add(
            FindingRow(
                tenant_id=tenant_id,
                finding_id=str(f.id),
                submission_id=submission_id,
                check_id=f.check_id,
                node_id=f.node_id,
                severity=f.severity,
                message=f.message,
                payload_json=f.model_dump_json(),
                resolution=res_state,
                resolution_reason=res_reason,
                resolved_by=res_by,
            )
        )
    await session.flush()


async def list_findings(session: AsyncSession, submission_id: int) -> list[FindingRow]:
    res = await session.execute(
        select(FindingRow).where(FindingRow.submission_id == submission_id).order_by(FindingRow.id)
    )
    return list(res.scalars().all())


async def list_all_findings(
    session: AsyncSession,
    *,
    limit: int = 500,
    tenant_id: str | None = None,
    canon_id: str | None = None,
) -> list[FindingRow]:
    stmt = select(FindingRow)
    if canon_id is not None:
        stmt = stmt.join(SubmissionRow, FindingRow.submission_id == SubmissionRow.id).where(
            SubmissionRow.canon_id == canon_id
        )
    if tenant_id is not None:
        stmt = stmt.where(FindingRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(desc(FindingRow.id)).limit(limit))
    return list(res.scalars().all())


async def get_finding_by_row_id(session: AsyncSession, row_id: int) -> FindingRow | None:
    res = await session.execute(select(FindingRow).where(FindingRow.id == row_id))
    return res.scalar_one_or_none()


async def list_versions(session: AsyncSession, submission_id: int) -> list[SubmissionVersionRow]:
    res = await session.execute(
        select(SubmissionVersionRow)
        .where(SubmissionVersionRow.submission_id == submission_id)
        .order_by(desc(SubmissionVersionRow.version_number))
    )
    return list(res.scalars().all())


async def add_comment(
    session: AsyncSession,
    *,
    submission_id: int,
    finding_id: int | None,
    author: UserRow,
    body: str,
) -> SubmissionCommentRow:
    row = SubmissionCommentRow(
        tenant_id=author.tenant_id,
        submission_id=submission_id,
        finding_id=finding_id,
        author_id=author.id,
        author_name=author.display_name,
        role=author.role,
        body=body,
    )
    session.add(row)
    await session.flush()
    return row


async def list_comments(session: AsyncSession, submission_id: int) -> list[SubmissionCommentRow]:
    res = await session.execute(
        select(SubmissionCommentRow)
        .where(SubmissionCommentRow.submission_id == submission_id)
        .order_by(SubmissionCommentRow.id)
    )
    return list(res.scalars().all())


async def append_workflow_event(
    session: AsyncSession,
    *,
    submission_id: int,
    action: str,
    actor: UserRow,
    comment: str,
    lock_held: bool = False,
) -> WorkflowEventRow:
    async def _append_inner() -> WorkflowEventRow:
        bind = session.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                {"k": f"pramaan:wf_chain:{actor.tenant_id}"},
            )
        last_res = await session.execute(
            select(WorkflowEventRow)
            .where(WorkflowEventRow.tenant_id == actor.tenant_id)
            .order_by(desc(WorkflowEventRow.id))
            .limit(1)
        )
        last_row = last_res.scalar_one_or_none()
        prev_hash = last_row.event_hash if last_row else GENESIS_HASH
        ts = dt.datetime.now(dt.UTC).isoformat()
        ev_hash = compute_event_hash(prev_hash, submission_id, action, actor.id, ts)
        row = WorkflowEventRow(
            tenant_id=actor.tenant_id,
            submission_id=submission_id,
            action=action,
            actor_id=actor.id,
            actor_name=actor.display_name,
            comment=comment,
            prev_hash=prev_hash,
            event_hash=ev_hash,
            created_at=dt.datetime.fromisoformat(ts),
        )
        session.add(row)
        await session.flush()
        return row

    if lock_held:
        return await _append_inner()
    async with _WF_CHAIN_LOCK:
        return await _append_inner()


async def list_workflow_events(
    session: AsyncSession,
    *,
    tenant_id: str | None = None,
) -> list[WorkflowEventRow]:
    stmt = select(WorkflowEventRow)
    if tenant_id is not None:
        stmt = stmt.where(WorkflowEventRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(WorkflowEventRow.id))
    return list(res.scalars().all())


def to_audit_chain_events(rows: list[WorkflowEventRow]) -> list[AuditChainEvent]:
    return [
        AuditChainEvent(
            submission_id=r.submission_id,
            action=r.action,
            actor_id=r.actor_id,
            timestamp=r.created_at.isoformat() if r.created_at.tzinfo else r.created_at.replace(tzinfo=dt.UTC).isoformat(),
            prev_hash=r.prev_hash,
            event_hash=r.event_hash,
        )
        for r in rows
    ]


async def save_stored_document(session: AsyncSession, row: StoredDocumentRow) -> StoredDocumentRow:
    existing = await session.get(StoredDocumentRow, row.doc_id)
    if existing:
        if existing.tenant_id != row.tenant_id:
            raise PermissionError(f"Document {row.doc_id!r} belongs to another tenant")
        existing.filename = row.filename
        existing.filepath = row.filepath
        existing.page_count = row.page_count
        existing.scanned_pages_json = row.scanned_pages_json
        existing.anomalies_json = row.anomalies_json
        existing.facts_json = row.facts_json
        existing.page_texts_json = row.page_texts_json
        return existing
    session.add(row)
    await session.flush()
    return row


async def list_stored_documents(
    session: AsyncSession,
    *,
    tenant_id: str | None = None,
) -> list[StoredDocumentRow]:
    stmt = select(StoredDocumentRow)
    if tenant_id is not None:
        stmt = stmt.where(StoredDocumentRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(desc(StoredDocumentRow.created_at)))
    return list(res.scalars().all())


async def get_stored_document(session: AsyncSession, doc_id: str) -> StoredDocumentRow | None:
    return await session.get(StoredDocumentRow, doc_id)


async def save_claim_graph(
    session: AsyncSession,
    graph_id: str,
    payload_json: str,
    *,
    tenant_id: str = "default",
) -> None:
    existing = await session.get(ClaimGraphRow, graph_id)
    if existing:
        if existing.tenant_id != tenant_id:
            raise PermissionError(f"Claim graph {graph_id!r} belongs to another tenant")
        existing.payload_json = payload_json
    else:
        session.add(ClaimGraphRow(graph_id=graph_id, tenant_id=tenant_id, payload_json=payload_json))
    await session.flush()


async def get_latest_claim_graph(
    session: AsyncSession,
    *,
    tenant_id: str | None = None,
) -> ClaimGraphRow | None:
    stmt = select(ClaimGraphRow)
    if tenant_id is not None:
        stmt = stmt.where(ClaimGraphRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(desc(ClaimGraphRow.created_at)).limit(1))
    return res.scalar_one_or_none()


async def save_compiled_canon(
    session: AsyncSession,
    *,
    canon_id: str,
    yaml_content: str,
    tenant_id: str = "default",
) -> None:
    res = await session.execute(
        select(CompiledCanonRow).where(
            CompiledCanonRow.tenant_id == tenant_id,
            CompiledCanonRow.canon_id == canon_id,
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        existing.yaml_content = yaml_content
    else:
        session.add(CompiledCanonRow(canon_id=canon_id, tenant_id=tenant_id, yaml_content=yaml_content))
    await session.flush()


async def get_compiled_canon(
    session: AsyncSession,
    canon_id: str,
    *,
    tenant_id: str,
) -> CompiledCanonRow | None:
    res = await session.execute(
        select(CompiledCanonRow).where(
            CompiledCanonRow.tenant_id == tenant_id,
            CompiledCanonRow.canon_id == canon_id,
        )
    )
    return res.scalar_one_or_none()


async def list_compiled_canons(
    session: AsyncSession,
    *,
    tenant_id: str | None = None,
) -> list[CompiledCanonRow]:
    stmt = select(CompiledCanonRow)
    if tenant_id is not None:
        stmt = stmt.where(CompiledCanonRow.tenant_id == tenant_id)
    res = await session.execute(stmt.order_by(CompiledCanonRow.created_at))
    return list(res.scalars().all())
