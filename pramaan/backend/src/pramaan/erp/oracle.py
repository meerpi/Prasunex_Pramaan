"""Thread-safe Multi-Tenant SQLAlchemy (SQLite WAL + PostgreSQL RLS) Campus ERP, DPDP Consent, CRL & Key Ring Store.

Starts completely empty — zero default or synthetic institutional records are seeded.
All tenant reads and writes are isolated by `tenant_id` and bind `app.current_tenant`
inside PostgreSQL transactions so Row-Level Security (`FORCE ROW LEVEL SECURITY`) is enforced.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import importlib.util
import itertools
import json
import threading
from collections.abc import Iterator, Sequence
from contextvars import ContextVar
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import StaticPool

from pramaan.erp.k12_qc import (
    K12QcValidationReport,
    K12SchoolDisclosureRecord,
    parse_indian_date,
    validate_k12_4gate_qc,
)

_IST = ZoneInfo("Asia/Kolkata")
_CURRENT_ERP_TENANT: ContextVar[str] = ContextVar("pramaan_erp_tenant", default="default")
_ERP_LOOKUP_SCOPE: ContextVar[str] = ContextVar("pramaan_erp_lookup_scope", default="none")
parse_consent_date = parse_indian_date


def set_erp_tenant(tenant_id: str) -> None:
    _CURRENT_ERP_TENANT.set((tenant_id or "default").strip() or "default")


def current_erp_tenant() -> str:
    return _CURRENT_ERP_TENANT.get()


def set_erp_lookup_scope(scope: str) -> None:
    _ERP_LOOKUP_SCOPE.set((scope or "none").strip() or "none")


def current_erp_lookup_scope() -> str:
    return _ERP_LOOKUP_SCOPE.get()


@contextlib.contextmanager
def scoped_erp_lookup(scope: str):
    """Temporarily restrict ERP witness queries inside ClaimAlgebraZ3Check ('full', 'none', or 'prn:<PRN>')."""
    token = _ERP_LOOKUP_SCOPE.set((scope or "none").strip() or "none")
    try:
        yield
    finally:
        _ERP_LOOKUP_SCOPE.reset(token)


def is_consent_active(consent: DpdpConsentRecord, *, today: dt.date | None = None) -> bool:
    """Return True iff consent is not revoked and its expiry date has not elapsed in IST."""
    if consent.revoked:
        return False
    exp = parse_consent_date(consent.expires_at)
    if exp is None:
        return False
    ref_day = today or dt.datetime.now(_IST).date()
    return exp >= ref_day


def sync_database_url(database_url: str | Path) -> str:
    """Convert async SQLAlchemy URLs (`sqlite+aiosqlite`, `postgresql+asyncpg`) or raw paths into sync URLs."""
    raw = str(database_url).strip()
    if not raw or raw == ":memory:":
        return "sqlite:///:memory:"
    if raw.startswith("sqlite+aiosqlite://"):
        return "sqlite://" + raw.removeprefix("sqlite+aiosqlite://")
    if raw.startswith("sqlite://"):
        return raw
    if raw.startswith("postgresql+asyncpg://") or raw.startswith("postgres://") or raw.startswith("postgresql://"):
        rest = raw.split("://", 1)[1]
        if importlib.util.find_spec("psycopg") is not None:
            return f"postgresql+psycopg://{rest}"
        if importlib.util.find_spec("psycopg2") is not None:
            return f"postgresql+psycopg2://{rest}"
        return f"postgresql://{rest}"
    if "://" in raw:
        return raw
    return f"sqlite:///{Path(raw).resolve()}"


class CourseGradeRecord(BaseModel):
    course_code: str = Field(min_length=1, max_length=32)
    course_title: str = Field(min_length=1, max_length=160)
    credits: float = Field(gt=0.0, le=30.0)
    grade_point: float = Field(ge=0.0, le=10.0)
    semester: int = Field(ge=1, le=16)


class AttendanceRecord(BaseModel):
    course_code: str = Field(min_length=1, max_length=32)
    course_title: str = Field(min_length=1, max_length=160)
    attended_classes: int = Field(ge=0, le=10_000)
    total_classes: int = Field(ge=1, le=10_000)
    medical_condonation_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    approved_by_medical_board: bool = False

    @model_validator(mode="after")
    def _validate_attendance_bounds(self) -> AttendanceRecord:
        if self.attended_classes > self.total_classes:
            raise ValueError(
                f"attended_classes ({self.attended_classes}) cannot exceed total_classes ({self.total_classes})"
            )
        return self

    @computed_field
    @property
    def raw_pct(self) -> float:
        return round((self.attended_classes / max(1, self.total_classes)) * 100.0, 2)

    def effective_pct_for_cap(self, max_cap: float = 10.0) -> float:
        capped = min(max(0.0, max_cap), max(0.0, self.medical_condonation_pct))
        return round(min(100.0, self.raw_pct + capped), 2)

    @computed_field
    @property
    def effective_pct(self) -> float:
        return self.effective_pct_for_cap(10.0)


class StudentRecord(BaseModel):
    prn: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=1, max_length=120)
    program: str = Field(min_length=1, max_length=120)
    batch_year: int = Field(ge=1950, le=2100)
    department: str = Field(min_length=1, max_length=120)
    education_level: str = Field(default="HEI", max_length=16)
    age_years: int = Field(default=21, ge=3, le=120)
    is_minor: bool = False
    declared_cgpa: float = Field(ge=0.0, le=10.0)
    active_backlogs: int = Field(default=0, ge=0, le=50)
    degree_status: str = Field(default="Enrolled", max_length=80)
    parent_username: str = Field(default="", max_length=80)
    disciplinary_standing: str = Field(default="", max_length=120)
    courses: list[CourseGradeRecord] = Field(default_factory=list, max_length=120)
    attendance: list[AttendanceRecord] = Field(default_factory=list, max_length=120)


class PublicationRecord(BaseModel):
    doi: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=300)
    venue: str = Field(min_length=1, max_length=200)
    indexing: str = Field(max_length=64)  # "Scopus" | "UGC-CARE" | "IEEE" | "Unverified"
    year: int = Field(ge=1950, le=2100)
    faculty_id: str = Field(min_length=1, max_length=40)
    verified: bool = True


class FacultyRecord(BaseModel):
    faculty_id: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=1, max_length=120)
    designation: str = Field(min_length=1, max_length=120)
    department: str = Field(min_length=1, max_length=120)
    biometric_days_present: int = Field(ge=0, le=366)
    working_days_total: int = Field(ge=1, le=366)
    sponsored_grant_inr_lakhs: float = Field(ge=0.0, le=100_000.0)
    publications: list[PublicationRecord] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _validate_presence(self) -> FacultyRecord:
        if self.biometric_days_present > self.working_days_total:
            raise ValueError(
                f"biometric_days_present ({self.biometric_days_present}) cannot exceed working_days_total ({self.working_days_total})"
            )
        return self


class PlacementCellRecord(BaseModel):
    academic_year: str = Field(min_length=1, max_length=32)
    department: str = Field(min_length=1, max_length=120)
    batch_total: int = Field(ge=1, le=500_000)
    opting_in_eligible: int = Field(ge=0, le=500_000)
    placed_students: int = Field(ge=0, le=500_000)
    highest_ctc_lakhs: float = Field(ge=0.0, le=10_000.0)
    median_ctc_lakhs: float = Field(ge=0.0, le=10_000.0)
    top_recruiters: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("top_recruiters")
    @classmethod
    def _validate_recruiter_lengths(cls, v: list[str]) -> list[str]:
        for name in v:
            if len(name) > 120:
                raise ValueError("Each top_recruiters entry must be 120 characters or fewer")
        return v

    @model_validator(mode="after")
    def _validate_denominators(self) -> PlacementCellRecord:
        if self.opting_in_eligible > self.batch_total:
            raise ValueError(
                f"opting_in_eligible ({self.opting_in_eligible}) cannot exceed batch_total ({self.batch_total})"
            )
        if self.placed_students > self.opting_in_eligible:
            raise ValueError(
                f"placed_students ({self.placed_students}) cannot exceed opting_in_eligible ({self.opting_in_eligible})"
            )
        if self.highest_ctc_lakhs > 0 and self.median_ctc_lakhs > self.highest_ctc_lakhs:
            raise ValueError(
                f"median_ctc_lakhs ({self.median_ctc_lakhs}) cannot exceed highest_ctc_lakhs ({self.highest_ctc_lakhs})"
            )
        return self


class InstitutionalMetrics(BaseModel):
    academic_year: str = Field(min_length=1, max_length=32)
    fiscal_year: str = Field(min_length=1, max_length=32)
    naac_grade: str = Field(min_length=1, max_length=24)
    naac_cycle_valid_until: str = Field(min_length=4, max_length=32)
    enrolled_learners: int = Field(ge=1, le=1_000_000)
    regular_faculty_count: int = Field(ge=1, le=200_000)
    criterion4_infra_spend_crores: float = Field(ge=0.0, le=100_000.0)
    budget_heads: dict[str, float] = Field(default_factory=dict)
    min_attendance_pct: float = Field(default=75.0, ge=0.0, le=100.0)
    max_medical_condonation_pct: float = Field(default=10.0, ge=0.0, le=100.0)
    cgpa_exemption_threshold: float | None = Field(default=None, ge=0.0, le=10.0)

    @field_validator("budget_heads")
    @classmethod
    def _validate_budget_heads(cls, v: dict[str, float]) -> dict[str, float]:
        if len(v) > 200:
            raise ValueError("budget_heads supports at most 200 entries")
        for k in v:
            if len(k) > 120:
                raise ValueError("Each budget head key must be 120 characters or fewer")
        return v


class DpdpConsentRecord(BaseModel):
    consent_id: str = Field(max_length=64)
    student_prn: str = Field(max_length=40)
    guardian_username: str = Field(max_length=80)
    grantee_name: str = Field(max_length=160)
    allowed_claims: list[str] = Field(max_length=32)
    purpose: str = Field(max_length=256)
    expires_at: str = Field(max_length=32)
    revoked: bool = False
    tenant_id: str = Field(default="default", max_length=64)
    digilocker_verified: bool = False
    digilocker_tx_id: str = Field(default="", max_length=160)
    verified_at: str = Field(default="", max_length=64)
    verification_mode: str = Field(default="local_erp", max_length=32)


class StoredSigningKey(BaseModel):
    kid: str = Field(min_length=2, max_length=64)
    secret_material: str = Field(min_length=16, max_length=256)
    status: str = Field(default="active", max_length=16)  # "active" | "retired"
    created_at: str
    retired_at: str = ""


def merge_student_record(rec: StudentRecord, prev: StudentRecord | None) -> StudentRecord:
    """Normalize a student record and preserve prior courses/attendance/standing on updates."""
    prn = rec.prn.strip()
    merged_courses = list(rec.courses)
    merged_att = list(rec.attendance)
    if prev is not None:
        courses_by_code = {c.course_code: c for c in prev.courses}
        for c in rec.courses:
            courses_by_code[c.course_code] = c
        merged_courses = list(courses_by_code.values())
        att_by_code = {a.course_code: a for a in prev.attendance}
        for a in rec.attendance:
            att_by_code[a.course_code] = a
        merged_att = list(att_by_code.values())
    return rec.model_copy(
        update={
            "prn": prn,
            "is_minor": rec.age_years < 18,
            "courses": merged_courses,
            "attendance": merged_att,
            "disciplinary_standing": rec.disciplinary_standing or (prev.disciplinary_standing if prev else ""),
        }
    )


def merge_faculty_record(rec: FacultyRecord, prev: FacultyRecord | None) -> FacultyRecord:
    """Normalize a faculty record and preserve prior publications when omitted."""
    fid = rec.faculty_id.strip()
    merged_pubs = list(rec.publications) if (rec.publications or prev is None) else list(prev.publications)
    return rec.model_copy(update={"faculty_id": fid, "publications": merged_pubs})


def erp_core_ddls(is_postgres: bool) -> tuple[str, ...]:
    """DDL statements for Migration 0002 (unified multi-tenant ERP, consent, CRL, PKCE, batch tables)."""
    bool_type = "BOOLEAN NOT NULL DEFAULT FALSE" if is_postgres else "INTEGER NOT NULL DEFAULT 0"
    float_type = "DOUBLE PRECISION" if is_postgres else "REAL"
    return (
        """
        CREATE TABLE IF NOT EXISTS students (
            tenant_id TEXT NOT NULL DEFAULT 'default',
            prn TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (tenant_id, prn)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS faculty (
            tenant_id TEXT NOT NULL DEFAULT 'default',
            faculty_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (tenant_id, faculty_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS placements (
            tenant_id TEXT NOT NULL DEFAULT 'default',
            academic_year TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (tenant_id, academic_year)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS institutional_metrics (
            tenant_id TEXT NOT NULL DEFAULT 'default',
            academic_year TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (tenant_id, academic_year)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS k12_schools (
            tenant_id TEXT NOT NULL DEFAULT 'default',
            affiliation_qc_code TEXT NOT NULL,
            payload TEXT NOT NULL,
            qc_report_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_id, affiliation_qc_code)
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS dpdp_consents (
            consent_id TEXT PRIMARY KEY,
            student_prn TEXT NOT NULL,
            guardian_username TEXT NOT NULL,
            grantee_name TEXT NOT NULL,
            allowed_claims_json TEXT NOT NULL,
            purpose TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked {bool_type},
            tenant_id TEXT NOT NULL DEFAULT 'default',
            digilocker_verified {bool_type},
            digilocker_tx_id TEXT NOT NULL DEFAULT '',
            verified_at TEXT NOT NULL DEFAULT '',
            verification_mode TEXT NOT NULL DEFAULT 'local_erp'
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS crl_revocations (
            passport_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            reason TEXT NOT NULL,
            revoked_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS issued_passports (
            passport_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            holder_prn TEXT NOT NULL,
            grantee_name TEXT NOT NULL DEFAULT '',
            issued_at TEXT NOT NULL
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS pkce_verifiers (
            state TEXT PRIMARY KEY,
            expires_at {float_type} NOT NULL,
            code_verifier TEXT NOT NULL,
            consent_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS mcp_batch_jobs (
            job_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_dpdp_consents_tenant_prn ON dpdp_consents (tenant_id, student_prn)",
        "CREATE INDEX IF NOT EXISTS idx_crl_revocations_tenant_at ON crl_revocations (tenant_id, revoked_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_issued_passports_tenant_prn ON issued_passports (tenant_id, holder_prn)",
        "CREATE INDEX IF NOT EXISTS idx_pkce_verifiers_expires ON pkce_verifiers (expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_mcp_batch_jobs_tenant_created ON mcp_batch_jobs (tenant_id, created_at DESC)",
    )


def signing_keys_ddls() -> tuple[str, ...]:
    """DDL statements for Migration 0003 (versioned signing_keys registry)."""
    return (
        """
        CREATE TABLE IF NOT EXISTS signing_keys (
            kid TEXT PRIMARY KEY,
            secret_material TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            retired_at TEXT NOT NULL DEFAULT ''
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_signing_keys_status ON signing_keys (status)",
    )


def erp_schema_ddls(is_postgres: bool) -> tuple[str, ...]:
    """Complete unified ERP + signing key ring DDL tuple shared by ERPDataPort and migrations."""
    return (*erp_core_ddls(is_postgres), *signing_keys_ddls())


_COUNTABLE_TABLES = frozenset(
    {
        "students",
        "faculty",
        "placements",
        "institutional_metrics",
        "k12_schools",
        "dpdp_consents",
        "crl_revocations",
        "issued_passports",
        "mcp_batch_jobs",
    }
)
_KEY_LOOKUP_TABLES = frozenset({("students", "prn"), ("faculty", "faculty_id")})
_IN_CHUNK_SIZE = 500
_ORACLE_INSTANCE_SEQ = itertools.count(1)


class ERPDataPort:
    """Thread-safe Multi-Tenant SQLAlchemy (SQLite WAL + PostgreSQL RLS) Campus ERP Witness Store."""

    def __init__(self, db_path: str | Path = ":memory:", *, engine: Engine | None = None) -> None:
        self._instance_id = next(_ORACLE_INSTANCE_SEQ)
        self._db_url = sync_database_url(db_path)
        self._lock = threading.Lock()
        if engine is not None:
            self._engine = engine
            self._is_memory_sqlite = engine.dialect.name == "sqlite" and (
                engine.url.database in (None, "", ":memory:") or isinstance(engine.pool, StaticPool)
            )
        elif self._db_url.startswith("sqlite"):
            is_memory = self._db_url.endswith(":memory:")
            self._is_memory_sqlite = is_memory
            if not is_memory:
                file_path = Path(self._db_url.removeprefix("sqlite:///"))
                file_path.parent.mkdir(parents=True, exist_ok=True)
            kwargs: dict[str, object] = {
                "connect_args": {"check_same_thread": False},
                "future": True,
            }
            if is_memory:
                kwargs["poolclass"] = StaticPool
            self._engine = create_engine(self._db_url, **kwargs)

            @event.listens_for(self._engine, "connect")
            def _set_sqlite_pragmas(dbapi_conn, _conn_record) -> None:
                cur = dbapi_conn.cursor()
                if not is_memory:
                    cur.execute("PRAGMA journal_mode=WAL;")
                cur.execute("PRAGMA busy_timeout=5000;")
                cur.execute("PRAGMA foreign_keys=ON;")
                cur.close()
        else:
            self._is_memory_sqlite = False
            self._engine = create_engine(
                self._db_url,
                pool_size=10,
                max_overflow=10,
                pool_pre_ping=True,
                pool_recycle=1800,
                future=True,
            )

        self._is_postgres = self._engine.dialect.name == "postgresql"
        self._init_schema()

    @property
    def database_url(self) -> str:
        return self._db_url

    def dispose(self) -> None:
        self._engine.dispose()

    def _resolve_tenant(self, tenant_id: str | None) -> str:
        return (tenant_id or current_erp_tenant()).strip() or "default"

    @contextlib.contextmanager
    def _tx(
        self,
        tenant_id: str | None = None,
        *,
        set_rls: bool = True,
        write: bool = False,
    ) -> Iterator[tuple[Connection, str]]:
        tid = self._resolve_tenant(tenant_id)
        # In-memory StaticPool SQLite serializes all ops; file SQLite WAL keeps reads lock-free
        # while serializing read-modify-write merges; Postgres uses pooled DB concurrency + FOR UPDATE.
        need_lock = self._is_memory_sqlite or (write and not self._is_postgres)
        lock_ctx = self._lock if need_lock else contextlib.nullcontext()
        with lock_ctx, self._engine.begin() as conn:
            if self._is_postgres and set_rls:
                conn.execute(
                    text("SELECT set_config('app.current_tenant', :tid, true)"),
                    {"tid": tid},
                )
            yield conn, tid

    def _init_schema(self) -> None:
        ddls = erp_schema_ddls(self._is_postgres)
        # Non-superuser Postgres roles run against tables provisioned via migrations/postgres_rls.sql;
        # attempt idempotent DDL when permitted and safely ignore insufficient-privilege errors.
        lock_ctx = self._lock if self._is_memory_sqlite else contextlib.nullcontext()
        with lock_ctx:
            try:
                with self._engine.begin() as conn:
                    for stmt in ddls:
                        conn.execute(text(stmt))
                    if not self._is_postgres:
                        for col_ddl in (
                            "ALTER TABLE students ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE faculty ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE placements ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE institutional_metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE k12_schools ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE dpdp_consents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE dpdp_consents ADD COLUMN digilocker_verified INTEGER NOT NULL DEFAULT 0",
                            "ALTER TABLE dpdp_consents ADD COLUMN digilocker_tx_id TEXT NOT NULL DEFAULT ''",
                            "ALTER TABLE dpdp_consents ADD COLUMN verified_at TEXT NOT NULL DEFAULT ''",
                            "ALTER TABLE dpdp_consents ADD COLUMN verification_mode TEXT NOT NULL DEFAULT 'local_erp'",
                            "ALTER TABLE crl_revocations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE issued_passports ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
                            "ALTER TABLE issued_passports ADD COLUMN grantee_name TEXT NOT NULL DEFAULT ''",
                        ):
                            with contextlib.suppress(SQLAlchemyError):
                                conn.execute(text(col_ddl))
            except SQLAlchemyError:
                if not self._is_postgres:
                    raise

    def _bool_param(self, val: bool) -> bool | int:
        return bool(val) if self._is_postgres else (1 if val else 0)

    # --- Upsert / Write Methods (Atomic ON CONFLICT works on SQLite 3.24+ & PostgreSQL 16+) ---

    def _fetch_existing_payloads(
        self,
        conn: Connection,
        table_name: str,
        key_col: str,
        keys: Sequence[str],
        tid: str,
        *,
        for_update: bool = False,
    ) -> dict[str, str]:
        if (table_name, key_col) not in _KEY_LOOKUP_TABLES:
            raise ValueError(f"Unsupported key lookup target: {table_name}.{key_col}")
        unique_keys = list(dict.fromkeys(k.strip() for k in keys if k and k.strip()))
        out: dict[str, str] = {}
        lock_suffix = " FOR UPDATE" if (for_update and self._is_postgres) else ""
        for i in range(0, len(unique_keys), _IN_CHUNK_SIZE):
            chunk = unique_keys[i : i + _IN_CHUNK_SIZE]
            placeholders = ", ".join(f":k{j}" for j in range(len(chunk)))
            params: dict[str, object] = {"tid": tid}
            for j, val in enumerate(chunk):
                params[f"k{j}"] = val
            rows = conn.execute(
                text(
                    f"SELECT {key_col}, payload FROM {table_name} "
                    f"WHERE tenant_id = :tid AND {key_col} IN ({placeholders}){lock_suffix}"
                ),
                params,
            ).mappings().all()
            for r in rows:
                out[str(r[key_col])] = str(r["payload"])
        return out

    def count_table(self, table_name: str, *, tenant_id: str | None = None) -> int:
        if table_name not in _COUNTABLE_TABLES:
            raise ValueError(f"Unsupported countable table: {table_name!r}")
        with self._tx(tenant_id) as (conn, tid):
            total = conn.execute(
                text(f"SELECT COUNT(*) FROM {table_name} WHERE tenant_id = :tid"),
                {"tid": tid},
            ).scalar()
            return int(total or 0)

    def get_existing_keys(
        self,
        table_name: str,
        key_col: str,
        keys: Sequence[str],
        *,
        tenant_id: str | None = None,
    ) -> set[str]:
        if (table_name, key_col) not in _KEY_LOOKUP_TABLES:
            raise ValueError(f"Unsupported key lookup target: {table_name}.{key_col}")
        unique_keys = list(dict.fromkeys(k.strip() for k in keys if k and k.strip()))
        if not unique_keys:
            return set()
        found: set[str] = set()
        with self._tx(tenant_id) as (conn, tid):
            for i in range(0, len(unique_keys), _IN_CHUNK_SIZE):
                chunk = unique_keys[i : i + _IN_CHUNK_SIZE]
                placeholders = ", ".join(f":k{j}" for j in range(len(chunk)))
                params: dict[str, object] = {"tid": tid}
                for j, val in enumerate(chunk):
                    params[f"k{j}"] = val
                rows = conn.execute(
                    text(f"SELECT {key_col} FROM {table_name} WHERE tenant_id = :tid AND {key_col} IN ({placeholders})"),
                    params,
                ).fetchall()
                found.update(str(r[0]) for r in rows)
        return found

    def upsert_student(
        self,
        student: StudentRecord,
        *,
        tenant_id: str | None = None,
        merge_existing: bool = False,
    ) -> StudentRecord:
        prn = student.prn.strip()
        lock_suffix = " FOR UPDATE" if self._is_postgres else ""
        with self._tx(tenant_id, write=True) as (conn, tid):
            record = student
            if merge_existing:
                row = conn.execute(
                    text(f"SELECT payload FROM students WHERE tenant_id = :tid AND prn = :prn{lock_suffix}"),
                    {"tid": tid, "prn": prn},
                ).mappings().first()
                prev = StudentRecord.model_validate_json(str(row["payload"])) if row else None
                record = merge_student_record(student, prev)
            conn.execute(
                text(
                    """
                    INSERT INTO students (tenant_id, prn, payload)
                    VALUES (:tid, :prn, :payload)
                    ON CONFLICT (tenant_id, prn)
                    DO UPDATE SET payload = EXCLUDED.payload
                    """
                ),
                {"tid": tid, "prn": record.prn, "payload": record.model_dump_json()},
            )
        return record

    def bulk_upsert_students(
        self, records: Sequence[StudentRecord], *, tenant_id: str | None = None
    ) -> tuple[int, int]:
        """Atomically upsert a batch of student records, preserving prior courses/attendance on updates."""
        if not records:
            return (0, 0)
        created = 0
        updated = 0
        with self._tx(tenant_id, write=True) as (conn, tid):
            raw_existing = self._fetch_existing_payloads(
                conn, "students", "prn", [r.prn for r in records], tid, for_update=True
            )
            existing_by_prn = {
                prn: StudentRecord.model_validate_json(payload) for prn, payload in raw_existing.items()
            }
            upsert_sql = text(
                """
                INSERT INTO students (tenant_id, prn, payload)
                VALUES (:tid, :prn, :payload)
                ON CONFLICT (tenant_id, prn)
                DO UPDATE SET payload = EXCLUDED.payload
                """
            )
            params: list[dict[str, str]] = []
            for rec in records:
                prn = rec.prn.strip()
                prev = existing_by_prn.get(prn)
                if prev is not None:
                    updated += 1
                else:
                    created += 1
                normalized = merge_student_record(rec, prev)
                existing_by_prn[prn] = normalized
                params.append({"tid": tid, "prn": prn, "payload": normalized.model_dump_json()})
            conn.execute(upsert_sql, params)
        return (created, updated)

    def upsert_faculty(
        self,
        fac: FacultyRecord,
        *,
        tenant_id: str | None = None,
        merge_existing: bool = False,
    ) -> FacultyRecord:
        fid = fac.faculty_id.strip()
        lock_suffix = " FOR UPDATE" if self._is_postgres else ""
        with self._tx(tenant_id, write=True) as (conn, tid):
            record = fac
            if merge_existing:
                row = conn.execute(
                    text(f"SELECT payload FROM faculty WHERE tenant_id = :tid AND faculty_id = :fid{lock_suffix}"),
                    {"tid": tid, "fid": fid},
                ).mappings().first()
                prev = FacultyRecord.model_validate_json(str(row["payload"])) if row else None
                record = merge_faculty_record(fac, prev)
            conn.execute(
                text(
                    """
                    INSERT INTO faculty (tenant_id, faculty_id, payload)
                    VALUES (:tid, :fid, :payload)
                    ON CONFLICT (tenant_id, faculty_id)
                    DO UPDATE SET payload = EXCLUDED.payload
                    """
                ),
                {"tid": tid, "fid": record.faculty_id, "payload": record.model_dump_json()},
            )
        return record

    def bulk_upsert_faculty(
        self, records: Sequence[FacultyRecord], *, tenant_id: str | None = None
    ) -> tuple[int, int]:
        """Atomically upsert a batch of faculty records, preserving prior publications when omitted."""
        if not records:
            return (0, 0)
        created = 0
        updated = 0
        with self._tx(tenant_id, write=True) as (conn, tid):
            raw_existing = self._fetch_existing_payloads(
                conn, "faculty", "faculty_id", [r.faculty_id for r in records], tid, for_update=True
            )
            existing_by_id = {
                fid: FacultyRecord.model_validate_json(payload) for fid, payload in raw_existing.items()
            }
            upsert_sql = text(
                """
                INSERT INTO faculty (tenant_id, faculty_id, payload)
                VALUES (:tid, :fid, :payload)
                ON CONFLICT (tenant_id, faculty_id)
                DO UPDATE SET payload = EXCLUDED.payload
                """
            )
            params: list[dict[str, str]] = []
            for rec in records:
                fid = rec.faculty_id.strip()
                prev = existing_by_id.get(fid)
                if prev is not None:
                    updated += 1
                else:
                    created += 1
                normalized = merge_faculty_record(rec, prev)
                existing_by_id[fid] = normalized
                params.append({"tid": tid, "fid": fid, "payload": normalized.model_dump_json()})
            conn.execute(upsert_sql, params)
        return (created, updated)

    def upsert_placement_record(
        self, placement: PlacementCellRecord, *, tenant_id: str | None = None
    ) -> PlacementCellRecord:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO placements (tenant_id, academic_year, payload)
                    VALUES (:tid, :ay, :payload)
                    ON CONFLICT (tenant_id, academic_year)
                    DO UPDATE SET payload = EXCLUDED.payload
                    """
                ),
                {"tid": tid, "ay": placement.academic_year, "payload": placement.model_dump_json()},
            )
        return placement

    def upsert_institutional_metrics(
        self, metrics: InstitutionalMetrics, *, tenant_id: str | None = None
    ) -> InstitutionalMetrics:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO institutional_metrics (tenant_id, academic_year, payload)
                    VALUES (:tid, :ay, :payload)
                    ON CONFLICT (tenant_id, academic_year)
                    DO UPDATE SET payload = EXCLUDED.payload
                    """
                ),
                {"tid": tid, "ay": metrics.academic_year, "payload": metrics.model_dump_json()},
            )
        return metrics

    def upsert_k12_school_disclosure(
        self,
        school: K12SchoolDisclosureRecord,
        *,
        qc_report: K12QcValidationReport | None = None,
        tenant_id: str | None = None,
    ) -> tuple[K12SchoolDisclosureRecord, K12QcValidationReport]:
        report = qc_report or validate_k12_4gate_qc(school)
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO k12_schools (tenant_id, affiliation_qc_code, payload, qc_report_json)
                    VALUES (:tid, :code, :payload, :qc)
                    ON CONFLICT (tenant_id, affiliation_qc_code)
                    DO UPDATE SET payload = EXCLUDED.payload, qc_report_json = EXCLUDED.qc_report_json
                    """
                ),
                {"tid": tid, "code": school.affiliation_qc_code, "payload": school.model_dump_json(), "qc": "{}"},
            )
        return school, report

    def upsert_consent(self, consent: DpdpConsentRecord, *, tenant_id: str | None = None) -> DpdpConsentRecord:
        tid = self._resolve_tenant(tenant_id or consent.tenant_id)
        record = consent.model_copy(update={"tenant_id": tid})
        with self._tx(tid) as (conn, resolved_tid):
            conn.execute(
                text(
                    """
                    INSERT INTO dpdp_consents
                    (consent_id, student_prn, guardian_username, grantee_name, allowed_claims_json,
                     purpose, expires_at, revoked, tenant_id, digilocker_verified, digilocker_tx_id,
                     verified_at, verification_mode)
                    VALUES
                    (:cid, :prn, :g, :grantee, :claims, :purpose, :exp, :rev, :tid, :dlv, :dltx, :vat, :vmode)
                    ON CONFLICT (consent_id) DO UPDATE SET
                        student_prn = EXCLUDED.student_prn,
                        guardian_username = EXCLUDED.guardian_username,
                        grantee_name = EXCLUDED.grantee_name,
                        allowed_claims_json = EXCLUDED.allowed_claims_json,
                        purpose = EXCLUDED.purpose,
                        expires_at = EXCLUDED.expires_at,
                        revoked = EXCLUDED.revoked,
                        digilocker_verified = EXCLUDED.digilocker_verified,
                        digilocker_tx_id = EXCLUDED.digilocker_tx_id,
                        verified_at = EXCLUDED.verified_at,
                        verification_mode = EXCLUDED.verification_mode
                    WHERE dpdp_consents.tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {
                    "cid": record.consent_id,
                    "prn": record.student_prn,
                    "g": record.guardian_username,
                    "grantee": record.grantee_name,
                    "claims": json.dumps(record.allowed_claims),
                    "purpose": record.purpose,
                    "exp": record.expires_at,
                    "rev": self._bool_param(record.revoked),
                    "tid": resolved_tid,
                    "dlv": self._bool_param(record.digilocker_verified),
                    "dltx": record.digilocker_tx_id,
                    "vat": record.verified_at,
                    "vmode": record.verification_mode,
                },
            )
        return record

    # --- Tenant-Scoped Reads ---

    def get_student(self, prn: str, *, tenant_id: str | None = None) -> StudentRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            row = conn.execute(
                text("SELECT payload FROM students WHERE tenant_id = :tid AND prn = :prn"),
                {"tid": tid, "prn": prn},
            ).mappings().first()
            return StudentRecord.model_validate_json(str(row["payload"])) if row else None

    def list_students(
        self, *, parent_username: str | None = None, tenant_id: str | None = None
    ) -> list[StudentRecord]:
        with self._tx(tenant_id) as (conn, tid):
            rows = conn.execute(
                text("SELECT payload FROM students WHERE tenant_id = :tid ORDER BY prn"),
                {"tid": tid},
            ).mappings().all()
            out = [StudentRecord.model_validate_json(str(r["payload"])) for r in rows]
            if parent_username:
                return [s for s in out if s.parent_username == parent_username]
            return out

    def get_faculty(self, faculty_id: str, *, tenant_id: str | None = None) -> FacultyRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            row = conn.execute(
                text("SELECT payload FROM faculty WHERE tenant_id = :tid AND faculty_id = :fid"),
                {"tid": tid, "fid": faculty_id},
            ).mappings().first()
            return FacultyRecord.model_validate_json(str(row["payload"])) if row else None

    def sum_faculty_grants(self, *, tenant_id: str | None = None) -> float:
        with self._tx(tenant_id) as (conn, tid):
            rows = conn.execute(
                text("SELECT payload FROM faculty WHERE tenant_id = :tid"),
                {"tid": tid},
            ).fetchall()
            total = 0.0
            for (payload,) in rows:
                data = json.loads(str(payload))
                total += float(data.get("sponsored_grant_inr_lakhs") or 0.0)
            return round(total, 2)

    def list_faculty(self, *, tenant_id: str | None = None) -> list[FacultyRecord]:
        with self._tx(tenant_id) as (conn, tid):
            rows = conn.execute(
                text("SELECT payload FROM faculty WHERE tenant_id = :tid ORDER BY faculty_id"),
                {"tid": tid},
            ).mappings().all()
            return [FacultyRecord.model_validate_json(str(r["payload"])) for r in rows]

    def get_placement_record(
        self, academic_year: str | None = None, *, tenant_id: str | None = None
    ) -> PlacementCellRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            if academic_year:
                row = conn.execute(
                    text("SELECT payload FROM placements WHERE tenant_id = :tid AND academic_year = :ay"),
                    {"tid": tid, "ay": academic_year},
                ).mappings().first()
            else:
                row = conn.execute(
                    text("SELECT payload FROM placements WHERE tenant_id = :tid ORDER BY academic_year DESC LIMIT 1"),
                    {"tid": tid},
                ).mappings().first()
            return PlacementCellRecord.model_validate_json(str(row["payload"])) if row else None

    def get_institutional_metrics(
        self, academic_year: str | None = None, *, tenant_id: str | None = None
    ) -> InstitutionalMetrics | None:
        with self._tx(tenant_id) as (conn, tid):
            if academic_year:
                row = conn.execute(
                    text("SELECT payload FROM institutional_metrics WHERE tenant_id = :tid AND academic_year = :ay"),
                    {"tid": tid, "ay": academic_year},
                ).mappings().first()
            else:
                row = conn.execute(
                    text(
                        "SELECT payload FROM institutional_metrics WHERE tenant_id = :tid ORDER BY academic_year DESC LIMIT 1"
                    ),
                    {"tid": tid},
                ).mappings().first()
            return InstitutionalMetrics.model_validate_json(str(row["payload"])) if row else None

    def get_attendance_policy(
        self, *, tenant_id: str | None = None
    ) -> tuple[float, float, float | None]:
        """Return (min_attendance_pct, max_medical_condonation_pct, cgpa_exemption_threshold)."""
        m = self.get_institutional_metrics(tenant_id=tenant_id)
        if m is None:
            return (75.0, 10.0, None)
        return (m.min_attendance_pct, m.max_medical_condonation_pct, m.cgpa_exemption_threshold)

    def get_k12_school_disclosure(
        self, affiliation_qc_code: str | None = None, *, tenant_id: str | None = None
    ) -> K12SchoolDisclosureRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            if affiliation_qc_code:
                row = conn.execute(
                    text("SELECT payload FROM k12_schools WHERE tenant_id = :tid AND affiliation_qc_code = :code"),
                    {"tid": tid, "code": affiliation_qc_code},
                ).mappings().first()
            else:
                row = conn.execute(
                    text(
                        "SELECT payload FROM k12_schools WHERE tenant_id = :tid ORDER BY affiliation_qc_code DESC LIMIT 1"
                    ),
                    {"tid": tid},
                ).mappings().first()
            return K12SchoolDisclosureRecord.model_validate_json(str(row["payload"])) if row else None

    def _row_to_consent(self, r) -> DpdpConsentRecord:
        return DpdpConsentRecord(
            consent_id=str(r["consent_id"]),
            student_prn=str(r["student_prn"]),
            guardian_username=str(r["guardian_username"]),
            grantee_name=str(r["grantee_name"]),
            allowed_claims=json.loads(str(r["allowed_claims_json"])),
            purpose=str(r["purpose"]),
            expires_at=str(r["expires_at"]),
            revoked=bool(r["revoked"]),
            tenant_id=str(r["tenant_id"]) if "tenant_id" in r else "default",
            digilocker_verified=bool(r["digilocker_verified"]) if "digilocker_verified" in r else False,
            digilocker_tx_id=str(r["digilocker_tx_id"]) if "digilocker_tx_id" in r else "",
            verified_at=str(r["verified_at"]) if "verified_at" in r else "",
            verification_mode=str(r["verification_mode"]) if "verification_mode" in r else "local_erp",
        )

    def list_consents(
        self, *, student_prn: str | None = None, tenant_id: str | None = None
    ) -> list[DpdpConsentRecord]:
        with self._tx(tenant_id) as (conn, tid):
            if student_prn:
                rows = conn.execute(
                    text("SELECT * FROM dpdp_consents WHERE tenant_id = :tid AND student_prn = :prn"),
                    {"tid": tid, "prn": student_prn},
                ).mappings().all()
            else:
                rows = conn.execute(
                    text("SELECT * FROM dpdp_consents WHERE tenant_id = :tid"),
                    {"tid": tid},
                ).mappings().all()
            return [self._row_to_consent(r) for r in rows]

    def set_consent_status(
        self, consent_id: str, *, revoked: bool, tenant_id: str | None = None
    ) -> DpdpConsentRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text("UPDATE dpdp_consents SET revoked = :rev WHERE tenant_id = :tid AND consent_id = :cid"),
                {"rev": self._bool_param(revoked), "tid": tid, "cid": consent_id},
            )
            row = conn.execute(
                text("SELECT * FROM dpdp_consents WHERE tenant_id = :tid AND consent_id = :cid"),
                {"tid": tid, "cid": consent_id},
            ).mappings().first()
            return self._row_to_consent(row) if row else None

    def record_digilocker_verification(
        self,
        consent_id: str,
        *,
        tx_id: str,
        verified_at: str,
        mode: str = "live_digilocker_oauth2",
        tenant_id: str | None = None,
    ) -> DpdpConsentRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    UPDATE dpdp_consents
                    SET revoked = :rev,
                        digilocker_verified = :dlv,
                        digilocker_tx_id = :tx,
                        verified_at = :vat,
                        verification_mode = :mode
                    WHERE tenant_id = :tid AND consent_id = :cid
                    """
                ),
                {
                    "rev": self._bool_param(False),
                    "dlv": self._bool_param(True),
                    "tx": tx_id,
                    "vat": verified_at,
                    "mode": mode,
                    "tid": tid,
                    "cid": consent_id,
                },
            )
            row = conn.execute(
                text("SELECT * FROM dpdp_consents WHERE tenant_id = :tid AND consent_id = :cid"),
                {"tid": tid, "cid": consent_id},
            ).mappings().first()
            return self._row_to_consent(row) if row else None

    def get_consent(self, consent_id: str, *, tenant_id: str | None = None) -> DpdpConsentRecord | None:
        with self._tx(tenant_id) as (conn, tid):
            row = conn.execute(
                text("SELECT * FROM dpdp_consents WHERE tenant_id = :tid AND consent_id = :cid"),
                {"tid": tid, "cid": consent_id},
            ).mappings().first()
            return self._row_to_consent(row) if row else None

    def record_issued_passport(
        self,
        passport_id: str,
        holder_prn: str,
        *,
        grantee_name: str = "",
        tenant_id: str | None = None,
    ) -> None:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO issued_passports (passport_id, tenant_id, holder_prn, grantee_name, issued_at)
                    VALUES (:pid, :tid, :prn, :grantee, :at)
                    ON CONFLICT (passport_id) DO UPDATE SET
                        holder_prn = EXCLUDED.holder_prn,
                        grantee_name = EXCLUDED.grantee_name,
                        issued_at = EXCLUDED.issued_at
                    WHERE issued_passports.tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {
                    "pid": passport_id,
                    "tid": tid,
                    "prn": holder_prn,
                    "grantee": grantee_name.strip(),
                    "at": dt.datetime.now(dt.UTC).isoformat(),
                },
            )

    def get_issued_passport(
        self, passport_id: str, *, tenant_id: str | None = None
    ) -> tuple[str, str] | None:
        with self._tx(tenant_id) as (conn, tid):
            row = conn.execute(
                text(
                    "SELECT holder_prn, grantee_name FROM issued_passports WHERE tenant_id = :tid AND passport_id = :pid"
                ),
                {"tid": tid, "pid": passport_id},
            ).mappings().first()
            return (str(row["holder_prn"]), str(row["grantee_name"] or "")) if row else None

    def get_passport_owner(self, passport_id: str, *, tenant_id: str | None = None) -> str | None:
        rec = self.get_issued_passport(passport_id, tenant_id=tenant_id)
        return rec[0] if rec else None

    def list_issued_passports(
        self,
        holder_prn: str,
        *,
        tenant_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, object]]:
        with self._tx(tenant_id) as (conn, tid):
            rows = conn.execute(
                text(
                    """
                    SELECT
                        p.passport_id,
                        p.grantee_name,
                        p.issued_at,
                        c.reason AS revoked_reason,
                        c.revoked_at AS revoked_at
                    FROM issued_passports p
                    LEFT JOIN crl_revocations c
                        ON c.passport_id = p.passport_id AND c.tenant_id = p.tenant_id
                    WHERE p.tenant_id = :tid AND p.holder_prn = :prn
                    ORDER BY p.issued_at DESC
                    LIMIT :lim
                    """
                ),
                {"tid": tid, "prn": holder_prn, "lim": max(1, min(limit, 200))},
            ).mappings().all()
            return [
                {
                    "passport_id": str(r["passport_id"]),
                    "grantee_name": str(r["grantee_name"] or ""),
                    "issued_at": str(r["issued_at"] or ""),
                    "revoked": r["revoked_at"] is not None,
                    "revoked_reason": str(r["revoked_reason"] or ""),
                    "revoked_at": str(r["revoked_at"] or ""),
                }
                for r in rows
            ]

    def save_pkce_verifier(
        self,
        state: str,
        *,
        expires_at: float,
        code_verifier: str,
        consent_id: str,
        tenant_id: str,
    ) -> None:
        now = dt.datetime.now(dt.UTC).timestamp()
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(text("DELETE FROM pkce_verifiers WHERE tenant_id = :tid AND expires_at <= :now"), {"tid": tid, "now": now})
            conn.execute(
                text(
                    """
                    INSERT INTO pkce_verifiers (state, expires_at, code_verifier, consent_id, tenant_id)
                    VALUES (:state, :exp, :ver, :cid, :tid)
                    ON CONFLICT (state) DO UPDATE SET
                        expires_at = EXCLUDED.expires_at,
                        code_verifier = EXCLUDED.code_verifier,
                        consent_id = EXCLUDED.consent_id
                    WHERE pkce_verifiers.tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {"state": state, "exp": expires_at, "ver": code_verifier, "cid": consent_id, "tid": tid},
            )

    def pop_pkce_verifier(self, state: str) -> tuple[float, str, str, str] | None:
        now = dt.datetime.now(dt.UTC).timestamp()
        with self._tx(set_rls=False) as (conn, _tid):
            if self._is_postgres:
                try:
                    with conn.begin_nested():
                        row = conn.execute(
                            text(
                                "SELECT expires_at, code_verifier, consent_id, tenant_id "
                                "FROM pramaan_pkce_pop(:state, :now)"
                            ),
                            {"state": state, "now": now},
                        ).mappings().first()
                    if row is None or float(row["expires_at"]) <= now:
                        return None
                    return (
                        float(row["expires_at"]),
                        str(row["code_verifier"]),
                        str(row["consent_id"]),
                        str(row["tenant_id"]),
                    )
                except SQLAlchemyError:
                    pass
            conn.execute(text("DELETE FROM pkce_verifiers WHERE expires_at <= :now"), {"now": now})
            row = conn.execute(
                text(
                    "SELECT expires_at, code_verifier, consent_id, tenant_id FROM pkce_verifiers WHERE state = :state"
                ),
                {"state": state},
            ).mappings().first()
            if row is not None:
                conn.execute(text("DELETE FROM pkce_verifiers WHERE state = :state"), {"state": state})
            if row is None or float(row["expires_at"]) <= now:
                return None
            return (
                float(row["expires_at"]),
                str(row["code_verifier"]),
                str(row["consent_id"]),
                str(row["tenant_id"]),
            )

    def save_mcp_batch_job(
        self, job_id: str, *, tenant_id: str, payload_json: str, created_at: str, max_rows: int = 128
    ) -> None:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO mcp_batch_jobs (job_id, tenant_id, payload_json, created_at)
                    VALUES (:jid, :tid, :payload, :at)
                    ON CONFLICT (job_id) DO UPDATE SET
                        payload_json = EXCLUDED.payload_json,
                        created_at = EXCLUDED.created_at
                    WHERE mcp_batch_jobs.tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {"jid": job_id, "tid": tid, "payload": payload_json, "at": created_at},
            )
            conn.execute(
                text(
                    """
                    DELETE FROM mcp_batch_jobs
                    WHERE tenant_id = :tid AND job_id NOT IN (
                        SELECT job_id FROM mcp_batch_jobs
                        WHERE tenant_id = :tid
                        ORDER BY created_at DESC LIMIT :lim
                    )
                    """
                ),
                {"tid": tid, "lim": max_rows},
            )

    def get_mcp_batch_job(self, job_id: str, *, tenant_id: str) -> str | None:
        with self._tx(tenant_id) as (conn, tid):
            row = conn.execute(
                text("SELECT payload_json FROM mcp_batch_jobs WHERE job_id = :jid AND tenant_id = :tid"),
                {"jid": job_id, "tid": tid},
            ).mappings().first()
            return str(row["payload_json"]) if row else None

    def revoke_passport(
        self,
        passport_id: str,
        reason: str = "Superseded or revoked by holder/institution",
        *,
        tenant_id: str | None = None,
    ) -> None:
        with self._tx(tenant_id) as (conn, tid):
            conn.execute(
                text(
                    """
                    INSERT INTO crl_revocations (passport_id, tenant_id, reason, revoked_at)
                    VALUES (:pid, :tid, :reason, :at)
                    ON CONFLICT (passport_id) DO UPDATE SET
                        reason = EXCLUDED.reason,
                        revoked_at = EXCLUDED.revoked_at
                    WHERE crl_revocations.tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {
                    "pid": passport_id,
                    "tid": tid,
                    "reason": reason,
                    "at": dt.datetime.now(dt.UTC).isoformat(),
                },
            )

    def is_passport_revoked(self, passport_id: str) -> tuple[bool, str | None]:
        with self._tx(set_rls=False) as (conn, _tid):
            if self._is_postgres:
                try:
                    with conn.begin_nested():
                        row = conn.execute(
                            text("SELECT reason FROM pramaan_crl_check(:pid)"),
                            {"pid": passport_id},
                        ).mappings().first()
                    return (True, str(row["reason"])) if row else (False, None)
                except SQLAlchemyError:
                    pass
            row = conn.execute(
                text("SELECT reason FROM crl_revocations WHERE passport_id = :pid"),
                {"pid": passport_id},
            ).mappings().first()
            return (True, str(row["reason"])) if row else (False, None)

    def list_revocations(self, *, tenant_id: str | None = None) -> list[dict[str, str]]:
        with self._tx(tenant_id) as (conn, tid):
            rows = conn.execute(
                text(
                    "SELECT passport_id, reason, revoked_at FROM crl_revocations WHERE tenant_id = :tid ORDER BY revoked_at DESC"
                ),
                {"tid": tid},
            ).mappings().all()
            return [{k: str(v) for k, v in r.items()} for r in rows]

    # --- Versioned Signing Key Ring Persistence (Instance-Wide Public Trust Registry) ---

    def list_signing_keys(self) -> list[StoredSigningKey]:
        with self._tx(set_rls=False) as (conn, _tid):
            rows = conn.execute(
                text(
                    "SELECT kid, secret_material, status, created_at, retired_at "
                    "FROM signing_keys ORDER BY created_at DESC"
                )
            ).mappings().all()
            return [
                StoredSigningKey(
                    kid=str(r["kid"]),
                    secret_material=str(r["secret_material"]),
                    status=str(r["status"]),
                    created_at=str(r["created_at"]),
                    retired_at=str(r["retired_at"] or ""),
                )
                for r in rows
            ]

    def rotate_signing_keys_atomic(
        self,
        new_key: StoredSigningKey,
        *,
        seed_retired_key: StoredSigningKey | None = None,
    ) -> StoredSigningKey:
        """Atomically preserve an optional env seed key, retire active keys, and insert `new_key` without ever overwriting an existing `kid`."""
        now_iso = dt.datetime.now(dt.UTC).isoformat()
        insert_no_overwrite = text(
            """
            INSERT INTO signing_keys (kid, secret_material, status, created_at, retired_at)
            VALUES (:kid, :secret, :status, :created, :retired)
            ON CONFLICT (kid) DO NOTHING
            """
        )
        with self._tx(set_rls=False) as (conn, _tid):
            if seed_retired_key is not None:
                conn.execute(
                    insert_no_overwrite,
                    {
                        "kid": seed_retired_key.kid,
                        "secret": seed_retired_key.secret_material,
                        "status": "retired",
                        "created": seed_retired_key.created_at,
                        "retired": seed_retired_key.retired_at or now_iso,
                    },
                )
            existing = conn.execute(
                text("SELECT 1 FROM signing_keys WHERE kid = :kid"),
                {"kid": new_key.kid},
            ).first()
            if existing is not None:
                raise ValueError(f"Signing key ID {new_key.kid!r} already exists; choose a new unique key ID")
            if new_key.status == "active":
                conn.execute(
                    text(
                        "UPDATE signing_keys SET status = 'retired', retired_at = :now "
                        "WHERE status = 'active' AND kid != :kid"
                    ),
                    {"now": now_iso, "kid": new_key.kid},
                )
            res = conn.execute(
                insert_no_overwrite,
                {
                    "kid": new_key.kid,
                    "secret": new_key.secret_material,
                    "status": new_key.status,
                    "created": new_key.created_at,
                    "retired": new_key.retired_at,
                },
            )
            if int(res.rowcount or 0) == 0:
                raise ValueError(f"Signing key ID {new_key.kid!r} already exists; choose a new unique key ID")
        return new_key


_ORACLE_BY_URL: dict[str, ERPDataPort] = {}
_ORACLE_LOCK = threading.Lock()


def reset_erp_oracle_cache() -> None:
    """Dispose and clear cached ERPDataPort instances (used when switching DB URLs in tests)."""
    with _ORACLE_LOCK:
        for port in _ORACLE_BY_URL.values():
            with contextlib.suppress(Exception):
                port.dispose()
        _ORACLE_BY_URL.clear()


def default_erp_oracle() -> ERPDataPort:
    from pramaan.settings import get_settings

    db_url = sync_database_url(get_settings().database_url)
    with _ORACLE_LOCK:
        oracle = _ORACLE_BY_URL.get(db_url)
        if oracle is None:
            oracle = ERPDataPort(db_path=db_url)
            _ORACLE_BY_URL[db_url] = oracle
        return oracle
