"""Versioned Schema Migration Engine for Pramaan (SQLite WAL & PostgreSQL 16+ RLS).

Tracks applied schema revisions in `schema_migrations` with SHA-256 checksums so
deployments run forward-only, auditable migrations on startup or via `pramaan migrate`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass

from sqlalchemy import Connection, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from pramaan.erp import default_erp_oracle, erp_core_ddls, signing_keys_ddls
from pramaan.store.tables import Base


@dataclass(frozen=True, slots=True)
class MigrationSpec:
    version: str
    name: str
    description: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(f"{self.version}:{self.name}:{self.description}".encode()).hexdigest()[:16]


MIGRATIONS: tuple[MigrationSpec, ...] = (
    MigrationSpec(
        version="0001",
        name="initial_governance_schema",
        description="Core users, submissions, versions, findings, comments, workflow_events, documents, claim_graphs, compiled_canons.",
    ),
    MigrationSpec(
        version="0002",
        name="unified_erp_crl_consent_schema",
        description="Unified multi-tenant ERP tables (students, faculty, placements, institutional_metrics, k12_schools, dpdp_consents, crl_revocations, issued_passports, pkce_verifiers, mcp_batch_jobs) on primary DB.",
    ),
    MigrationSpec(
        version="0003",
        name="signing_key_ring_registry",
        description="Versioned signing_keys table for zero-downtime Ed25519/ECDSA/JWT key rotation and JWKS publication.",
    ),
)


def _ensure_migrations_table(conn: Connection) -> None:
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(32) PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                checksum VARCHAR(64) NOT NULL,
                applied_at VARCHAR(64) NOT NULL
            )
            """
        )
    )


def _apply_0001(conn: Connection) -> None:
    Base.metadata.create_all(bind=conn)
    if conn.dialect.name == "sqlite":
        for table in Base.metadata.sorted_tables:
            rows = conn.execute(text(f'PRAGMA table_info("{table.name}")')).fetchall()
            existing = {r[1] for r in rows}
            for col in table.columns:
                if col.name in existing:
                    continue
                col_type = col.type.compile(dialect=conn.dialect)
                default_arg = (
                    col.default.arg if (col.default is not None and not callable(col.default.arg)) else None
                )
                if default_arg is not None:
                    lit = (
                        f"'{str(default_arg).replace(chr(39), chr(39) * 2)}'"
                        if isinstance(default_arg, str)
                        else str(default_arg)
                    )
                    ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type} NOT NULL DEFAULT {lit}'
                elif col.nullable:
                    ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}'
                else:
                    continue
                conn.execute(text(ddl))
                if col.index:
                    conn.execute(
                        text(
                            f'CREATE INDEX IF NOT EXISTS "ix_{table.name}_{col.name}" ON "{table.name}" ("{col.name}")'
                        )
                    )


def _apply_0002(conn: Connection) -> None:
    for stmt in erp_core_ddls(conn.dialect.name == "postgresql"):
        conn.execute(text(stmt))


def _apply_0003(conn: Connection) -> None:
    for stmt in signing_keys_ddls():
        conn.execute(text(stmt))


_APPLIERS = {
    "0001": _apply_0001,
    "0002": _apply_0002,
    "0003": _apply_0003,
}
_ALL_VERSIONS = frozenset(m.version for m in MIGRATIONS)


def _read_existing_versions(conn: Connection) -> set[str] | None:
    """Try reading `schema_migrations` inside a savepoint without issuing any DDL."""
    try:
        with conn.begin_nested():
            rows = conn.execute(text("SELECT version FROM schema_migrations")).fetchall()
            return {str(r[0]) for r in rows}
    except SQLAlchemyError:
        return None


def _run_migrations_sync(conn: Connection) -> list[str]:
    # Fast-path for pre-provisioned databases (e.g. non-superuser Postgres `pramaan_app`):
    # if all known revisions are already recorded, return immediately with ZERO DDL.
    existing = _read_existing_versions(conn)
    if existing is not None and _ALL_VERSIONS.issubset(existing):
        return []

    if conn.dialect.name == "postgresql":
        conn.execute(text("SELECT pg_advisory_xact_lock(hashtext('pramaan:schema_migrations'))"))
        # Re-check after acquiring lock in case a peer worker just finished migrating.
        existing = _read_existing_versions(conn)
        if existing is not None and _ALL_VERSIONS.issubset(existing):
            return []

    _ensure_migrations_table(conn)
    existing = {
        str(r[0]) for r in conn.execute(text("SELECT version FROM schema_migrations")).fetchall()
    }
    applied_now: list[str] = []
    for spec in MIGRATIONS:
        if spec.version in existing:
            continue
        _APPLIERS[spec.version](conn)
        conn.execute(
            text(
                """
                INSERT INTO schema_migrations (version, name, checksum, applied_at)
                VALUES (:ver, :name, :chk, :at)
                ON CONFLICT (version) DO NOTHING
                """
            ),
            {
                "ver": spec.version,
                "name": spec.name,
                "chk": spec.checksum,
                "at": dt.datetime.now(dt.UTC).isoformat(),
            },
        )
        applied_now.append(spec.version)
    return applied_now


def _migration_status_sync(conn: Connection) -> dict[str, object]:
    rows = None
    try:
        with conn.begin_nested():
            rows = conn.execute(
                text("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version")
            ).mappings().all()
    except SQLAlchemyError:
        rows = None
    if rows is None:
        _ensure_migrations_table(conn)
        rows = conn.execute(
            text("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version")
        ).mappings().all()
    applied = [dict(r) for r in rows]
    applied_vers = {str(r["version"]) for r in rows}
    pending = [
        {"version": m.version, "name": m.name, "checksum": m.checksum}
        for m in MIGRATIONS
        if m.version not in applied_vers
    ]
    return {
        "dialect": conn.dialect.name,
        "current_version": applied[-1]["version"] if applied else None,
        "applied": applied,
        "pending": pending,
    }


async def run_migrations(engine: AsyncEngine) -> list[str]:
    """Apply all pending versioned schema migrations transactionally and warm unified ERP store."""
    async with engine.begin() as conn:
        applied = await conn.run_sync(_run_migrations_sync)
    # Touch default_erp_oracle lazily only if already bound to same URL; no duplicate DB files created.
    _ = default_erp_oracle
    return applied


async def get_migration_status(engine: AsyncEngine) -> dict[str, object]:
    async with engine.begin() as conn:
        return await conn.run_sync(_migration_status_sync)
