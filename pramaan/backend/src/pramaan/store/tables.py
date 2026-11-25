"""SQLAlchemy 2.0 ORM tables for Pramaan governance workflow, evidence store, and claim graphs."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class UserRow(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "username", name="uq_users_tenant_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="student")
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    linked_prn: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    linked_faculty_id: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SubmissionRow(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    raw_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    canon_id: Mapped[str] = mapped_column(String(128), nullable=False)
    canon_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    portal_scope: Mapped[str] = mapped_column(String(32), nullable=False, default="student")
    creator_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    c2pa_manifest_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class SubmissionVersionRow(Base):
    __tablename__ = "submission_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    canon_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    change_note: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FindingRow(Base):
    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    finding_id: Mapped[str] = mapped_column(String(64), nullable=False)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    check_id: Mapped[str] = mapped_column(String(80), nullable=False)
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    severity: Mapped[int] = mapped_column(Integer, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    resolution: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    resolution_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    resolved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SubmissionCommentRow(Base):
    __tablename__ = "submission_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    finding_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    author_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    author_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class WorkflowEventRow(Base):
    __tablename__ = "workflow_events"
    __table_args__ = (UniqueConstraint("tenant_id", "prev_hash", name="uq_wf_events_tenant_prev_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class StoredDocumentRow(Base):
    __tablename__ = "stored_documents"

    doc_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    filepath: Mapped[str] = mapped_column(String(512), nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scanned_pages_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    anomalies_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    facts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    page_texts_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ClaimGraphRow(Base):
    __tablename__ = "claim_graphs"

    graph_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class CompiledCanonRow(Base):
    __tablename__ = "compiled_canons"
    __table_args__ = (UniqueConstraint("tenant_id", "canon_id", name="uq_compiled_canons_tenant_canon"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    canon_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default", index=True)
    yaml_content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
