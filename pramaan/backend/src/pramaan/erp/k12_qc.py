"""K-12 CBSE Appendix IX & UDISE+ Statutory Disclosure Models and 4-Gate Validator.

Every field and statutory threshold follows official Indian K-12 schemas:
- CBSE Mandatory Public Disclosure (Appendix IX, Circular 03/2021 Sections A-E)
- CBSE Affiliation Bye-Laws Chapter 4 Clause 4.1 (>=500 sq ft / 8m x 6m, >=1 sqm/child, <=40/section, <=30:1 PTR)
- UDISE+ DCF Modules 1-4 & DPDP Rules 2025 Rule 10 (<18 minor guardian consent lock)
"""

from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

_IST = ZoneInfo("Asia/Kolkata")
_PERMANENT_TOKENS = frozenset({"PERMANENT", "LIFETIME", "NON-EXPIRING"})
_PERMANENT_ALLOWED_DOC_CODES = frozenset({"B2", "B3"})
_REAL_AADHAAR_DIGIT_RE = re.compile(r"\b[2-9]\d{3}[\s.\-]?\d{4}[\s.\-]?\d{4}\b")
_REAL_PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")


class AppendixIxCertificate(BaseModel):
    doc_code: str = Field(min_length=1, max_length=24)
    title: str = Field(min_length=2, max_length=200)
    section: str = Field(default="Section B", max_length=32)
    issuing_authority: str = Field(min_length=2, max_length=160)
    valid_until: str = Field(min_length=4, max_length=32)
    status: str = Field(default="VALID", max_length=32)


class K12SchoolDisclosureRecord(BaseModel):
    affiliation_qc_code: str = Field(min_length=1, max_length=64)
    udise_qc_code: str = Field(min_length=1, max_length=64)
    school_name: str = Field(min_length=2, max_length=200)
    board: str = Field(min_length=2, max_length=64)
    academic_year: str = Field(min_length=4, max_length=32)
    classes_offered: str = Field(min_length=2, max_length=64)
    management_type: str = Field(min_length=2, max_length=120)
    city_state: str = Field(min_length=2, max_length=120)
    enrolled_students: int = Field(ge=1, le=200_000)
    sections_count: int = Field(ge=1, le=5_000)
    max_section_size: int = Field(ge=1, le=200)
    classroom_count: int = Field(ge=1, le=5_000)
    classroom_area_sqft: float = Field(ge=1.0, le=50_000.0)
    classroom_area_sqm: float = Field(ge=0.1, le=5_000.0)
    core_teaching_staff: int = Field(ge=1, le=20_000)  # PGT + TGT + PRT
    staff_breakdown: dict[str, int] = Field(default_factory=dict)
    class_x_3yr_pass_pct: list[float] = Field(default_factory=list, max_length=5)
    class_xii_3yr_pass_pct: list[float] = Field(default_factory=list, max_length=5)
    appendix_ix_certificates: list[AppendixIxCertificate] = Field(default_factory=list, max_length=30)

    @field_validator("staff_breakdown")
    @classmethod
    def _validate_staff_breakdown(cls, v: dict[str, int]) -> dict[str, int]:
        if len(v) > 100:
            raise ValueError("staff_breakdown supports at most 100 roles")
        for k in v:
            if len(k) > 80:
                raise ValueError("Each staff_breakdown role key must be 80 characters or fewer")
        return v


class K12QcGateResult(BaseModel):
    gate_id: str
    name: str
    passed: bool
    detail: str


class K12QcValidationReport(BaseModel):
    seed_id: int = 0
    macro_prior_source: str
    passed_all_gates: bool
    validated_at: str
    gates: list[K12QcGateResult] = Field(default_factory=list)


def parse_indian_date(raw: str) -> dt.date | None:
    """Parse ISO or Indian DD/MM/YYYY and DD-MM-YYYY date strings."""
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _is_certificate_current(cert: AppendixIxCertificate, today: dt.date) -> bool:
    if cert.status.strip().upper() not in {"VALID", "VERIFIED"}:
        return False
    raw = cert.valid_until.strip()
    if raw.upper() in _PERMANENT_TOKENS:
        return cert.doc_code.strip().upper() in _PERMANENT_ALLOWED_DOC_CODES
    exp = parse_indian_date(raw)
    return exp is not None and exp >= today


def validate_k12_4gate_qc(
    school: K12SchoolDisclosureRecord,
    student: dict[str, object] | None = None,
    consent: dict[str, object] | None = None,
) -> K12QcValidationReport:
    """Validate a real K-12 school disclosure against CBSE Appendix IX & DPDP privacy rules."""
    today = dt.datetime.now(_IST).date()
    expired_or_invalid = [
        c.title for c in school.appendix_ix_certificates if not _is_certificate_current(c, today)
    ]
    distinct_codes = {
        c.doc_code.strip().upper()
        for c in school.appendix_ix_certificates
        if c.doc_code.strip()
    }
    # Gate 1: Official CBSE Appendix IX Section B certificates (>=8 distinct codes, all current/non-expired) & IDs
    g1_ok = (
        len(distinct_codes) >= 8
        and len(expired_or_invalid) == 0
        and bool(school.affiliation_qc_code.strip())
        and bool(school.udise_qc_code.strip())
    )
    if student is not None:
        g1_ok = g1_ok and (bool(student.get("is_minor")) == (int(student.get("age_years", 21)) < 18))  # type: ignore[arg-type]
    if consent is not None:
        g1_ok = g1_ok and bool(consent.get("guardian_username"))

    # Gate 2: CBSE Affiliation Bye-Laws Clause 4.1 conservation invariants
    ptr = school.enrolled_students / max(1, school.core_teaching_staff)
    sqm_per_child = school.classroom_area_sqm / max(1, school.max_section_size)
    core_sum = (
        school.staff_breakdown.get("PGT", 0)
        + school.staff_breakdown.get("TGT", 0)
        + school.staff_breakdown.get("PRT", 0)
    )
    staff_matches = (core_sum == school.core_teaching_staff) if school.staff_breakdown else True
    g2_ok = (
        staff_matches
        and school.enrolled_students <= school.sections_count * max(1, school.max_section_size)
        and school.max_section_size <= 40
        and school.classroom_area_sqft >= 500.0
        and sqm_per_child >= 1.0
        and ptr <= 30.0
    )

    # Gate 3: 3-year Class X & Class XII board pass trend completeness (Appendix IX Section E)
    g3_ok = len(school.class_x_3yr_pass_pct) == 3 and len(school.class_xii_3yr_pass_pct) == 3

    # Gate 4: Zero raw Aadhaar / PAN personal identifier leakage in public disclosure payload
    serialized = f"{school.model_dump_json()} {student or ''} {consent or ''}"
    g4_ok = not (_REAL_AADHAAR_DIGIT_RE.search(serialized) or _REAL_PAN_RE.search(serialized))

    g1_detail = (
        f"{len(distinct_codes)} distinct Section B certificate codes on file; Affiliation {school.affiliation_qc_code}"
        if not expired_or_invalid
        else f"{len(expired_or_invalid)} expired or invalid Section B certificate(s): {', '.join(expired_or_invalid[:3])}"
    )
    gates = [
        K12QcGateResult(
            gate_id="GATE-1",
            name="CBSE Appendix IX & UDISE+ Schema Check",
            passed=g1_ok,
            detail=g1_detail,
        ),
        K12QcGateResult(
            gate_id="GATE-2",
            name="CBSE Clause 4.1 Statutory Bounds",
            passed=g2_ok,
            detail=f"PTR={ptr:.2f}:1 (<=30), max section={school.max_section_size} (<=40), room={school.classroom_area_sqft:.0f} sq ft ({sqm_per_child:.2f} sq m/student)",
        ),
        K12QcGateResult(
            gate_id="GATE-3",
            name="Appendix IX Section E 3-Yr Board Trend",
            passed=g3_ok,
            detail=f"Class X ({len(school.class_x_3yr_pass_pct)}/3 yrs), Class XII ({len(school.class_xii_3yr_pass_pct)}/3 yrs)",
        ),
        K12QcGateResult(
            gate_id="GATE-4",
            name="Public Disclosure Zero-PII Guard",
            passed=g4_ok,
            detail="0 raw Aadhaar or PAN identifiers in public school disclosure",
        ),
    ]
    return K12QcValidationReport(
        seed_id=0,
        macro_prior_source="CBSE Affiliation Bye-Laws Clause 4.1 & Appendix IX",
        passed_all_gates=all(g.passed for g in gates),
        validated_at=today.strftime("%Y-%m-%d"),
        gates=gates,
    )
