"""Pramaan 5-Portal Role Workbenches & Real Registrar ERP Management Routes."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from pramaan.api.deps import (
    AdminUser,
    CurrentUser,
    ParentOrAdminUser,
    RecruiterOrAdminUser,
    SessionDep,
    TeacherOrAdminUser,
    read_bounded_upload,
)
from pramaan.api.routes.canons import resolve_canon_for_tenant
from pramaan.checks import PersistentSmtSolver
from pramaan.domain import ContentAST, Role, TextNode
from pramaan.engine import default_calibrator, run_checks_collect
from pramaan.erp import (
    BULK_CSV_MAX_BYTES,
    FACULTY_CSV_TEMPLATE,
    STUDENTS_CSV_TEMPLATE,
    DpdpConsentRecord,
    FacultyRecord,
    InstitutionalMetrics,
    K12SchoolDisclosureRecord,
    PlacementCellRecord,
    StudentRecord,
    default_erp_oracle,
    is_consent_active,
    parse_faculty_csv,
    parse_students_csv,
    scoped_erp_lookup,
    summarize_bulk_preview,
    validate_k12_4gate_qc,
)
from pramaan.ledger import (
    create_digilocker_pkce_challenge,
    cross_verify_resume_against_claims,
    extract_qr_from_pdf_bytes,
    verify_digilocker_pkce_callback,
    verify_selective_passport_with_ring,
)
from pramaan.mcp import default_batch_runner
from pramaan.parsers import (
    build_pdf_text_and_anomaly_nodes,
    default_bundle_parser,
)
from pramaan.settings import get_settings
from pramaan.store import repos

router = APIRouter(prefix="/portals", tags=["portals"])


class ConsentToggleRequest(BaseModel):
    revoked: bool


class CreateConsentRequest(BaseModel):
    student_prn: str = Field(min_length=1, max_length=40)
    guardian_username: str = ""
    grantee_name: str = Field(min_length=2, max_length=160)
    allowed_claims: list[str] = Field(min_length=1)
    purpose: str = Field(min_length=3, max_length=256)
    expires_at: str = Field(min_length=4, max_length=32)
    revoked: bool = False


class CondonationAuditRequest(BaseModel):
    student_prn: str = Field(min_length=1, max_length=40)
    course_code: str = Field(min_length=1, max_length=32)
    proposed_condonation_pct: float = Field(ge=0.0, le=100.0)


class RecruiterCandidatePayload(BaseModel):
    name: str = Field(default="", max_length=160)
    content: str = Field(default="", max_length=50_000)


class RecruiterBatchRequest(BaseModel):
    canon_id: str = Field(default="pramaan-campus-placement", max_length=128)
    alpha: float = Field(default=0.10, ge=0.01, le=0.50)
    candidates: list[RecruiterCandidatePayload] = Field(min_length=1, max_length=100)


def _dump_student_with_cap(stu: StudentRecord, max_cap: float) -> dict[str, object]:
    """Serialize StudentRecord with attendance effective_pct computed under the institution's cap."""
    dumped = stu.model_dump()
    if stu.attendance:
        dumped["attendance"] = [
            {**att_dict, "effective_pct": att.effective_pct_for_cap(max_cap)}
            for att, att_dict in zip(stu.attendance, dumped["attendance"], strict=True)
        ]
    return dumped


@router.get("/student")
async def get_student_portal(user: CurrentUser, prn: str | None = None):
    erp = default_erp_oracle()
    if user.role == Role.STUDENT.value and prn and prn != user.linked_prn:
        raise HTTPException(status_code=403, detail="Students can access only their own academic record")
    target_prn = (user.linked_prn if user.role == Role.STUDENT.value else (prn or user.linked_prn)).strip()
    stu = await asyncio.to_thread(erp.get_student, target_prn, tenant_id=user.tenant_id) if target_prn else None
    if not stu:
        if prn:
            raise HTTPException(status_code=404, detail="Student record not found")
        return {
            "student": None,
            "z3_cgpa_proof": None,
            "consents": [],
            "minor_consent_locked": False,
            "placement_benchmark": None,
            "school_benchmark": None,
            "z3_k12_proofs": None,
            "k12_qc_report": None,
            "issued_passports": [],
            "attendance_policy": {
                "min_attendance_pct": 75.0,
                "max_medical_condonation_pct": 10.0,
                "cgpa_exemption_threshold": None,
                "student_exempt_by_cgpa": False,
            },
        }
    cgpa_breach, exact_cgpa, cgpa_solver = await asyncio.to_thread(
        PersistentSmtSolver.prove_cgpa_match, stu.declared_cgpa, stu.courses
    )
    consents = await asyncio.to_thread(erp.list_consents, student_prn=stu.prn, tenant_id=user.tenant_id)
    k12_school = (
        await asyncio.to_thread(erp.get_k12_school_disclosure, tenant_id=user.tenant_id)
        if stu.education_level == "K12"
        else None
    )
    k12_proofs = (
        await asyncio.to_thread(
            PersistentSmtSolver.prove_cbse_school_compliance,
            enrolled_students=k12_school.enrolled_students,
            sections_count=k12_school.sections_count,
            classroom_area_sqft=k12_school.classroom_area_sqft,
            classroom_area_sqm=k12_school.classroom_area_sqm,
            core_teaching_staff=k12_school.core_teaching_staff,
            max_section_size=k12_school.max_section_size,
        )
        if k12_school
        else None
    )
    placement = (
        await asyncio.to_thread(erp.get_placement_record, tenant_id=user.tenant_id)
        if stu.education_level != "K12"
        else None
    )
    k12_qc = validate_k12_4gate_qc(k12_school) if k12_school else None
    minor_consent_active = any(is_consent_active(c) for c in consents)
    issued_passports = await asyncio.to_thread(erp.list_issued_passports, stu.prn, tenant_id=user.tenant_id)
    min_att, max_cap, cgpa_exempt = await asyncio.to_thread(erp.get_attendance_policy, tenant_id=user.tenant_id)
    student_exempt = bool(cgpa_exempt is not None and stu.declared_cgpa >= cgpa_exempt)
    return {
        "student": _dump_student_with_cap(stu, max_cap),
        "z3_cgpa_proof": {
            "verified": not cgpa_breach,
            "declared_cgpa": stu.declared_cgpa,
            "weighted_exact_cgpa": exact_cgpa,
            "solver_id": cgpa_solver,
        },
        "consents": [c.model_dump() for c in consents],
        "minor_consent_locked": bool(stu.is_minor and not minor_consent_active),
        "placement_benchmark": placement.model_dump() if placement else None,
        "school_benchmark": k12_school.model_dump() if k12_school else None,
        "z3_k12_proofs": k12_proofs,
        "k12_qc_report": k12_qc.model_dump() if k12_qc else None,
        "issued_passports": issued_passports,
        "attendance_policy": {
            "min_attendance_pct": min_att,
            "max_medical_condonation_pct": max_cap,
            "cgpa_exemption_threshold": cgpa_exempt,
            "student_exempt_by_cgpa": student_exempt,
        },
    }


@router.get("/parent")
async def get_parent_portal(user: ParentOrAdminUser, session: SessionDep):
    erp = default_erp_oracle()
    children = await asyncio.to_thread(
        erp.list_students,
        parent_username=user.username if user.role == Role.PARENT.value else None,
        tenant_id=user.tenant_id,
    )
    child_prns = {s.prn for s in children}
    all_consents = await asyncio.to_thread(erp.list_consents, tenant_id=user.tenant_id) if child_prns else []
    consents = [c.model_dump() for c in all_consents if c.student_prn in child_prns]
    placement = await asyncio.to_thread(erp.get_placement_record, tenant_id=user.tenant_id)
    k12_school = await asyncio.to_thread(erp.get_k12_school_disclosure, tenant_id=user.tenant_id)
    k12_qc = validate_k12_4gate_qc(k12_school) if k12_school else None

    # Extract brochure claims ONLY from real PDFs uploaded by this institution — never fabricate copy
    brochure_claim_text = ""
    tenant_docs = await repos.list_stored_documents(session, tenant_id=user.tenant_id)
    brochure_doc = next(
        (
            d
            for d in tenant_docs
            if any(k in d.filename.lower() for k in ("brochure", "prospectus", "admission"))
        ),
        None,
    )
    if brochure_doc and brochure_doc.facts_json:
        try:
            b_facts = json.loads(brochure_doc.facts_json)
            quotes = [
                str((f.get("provenance") or {}).get("evidence_quote") or "").strip()
                for f in b_facts
                if isinstance(f, dict)
            ]
            quotes = [q for q in quotes if q]
            if quotes:
                brochure_claim_text = " · ".join(quotes[:2])
        except Exception:
            pass

    cfg = get_settings()
    return {
        "guardian": user.display_name,
        "digilocker_configured": bool(cfg.digilocker_client_id.strip()),
        "children": [c.model_dump() for c in children],
        "consents": consents,
        "placement_truth": placement.model_dump() if placement else None,
        "school_disclosure": k12_school.model_dump() if k12_school else None,
        "k12_qc_report": k12_qc.model_dump() if k12_qc else None,
        "brochure_vs_erp_discrepancy": (
            {
                "brochure_claim": brochure_claim_text,
                "brochure_filename": brochure_doc.filename if brochure_doc else "",
                "erp_verified": (
                    f"{round(placement.placed_students / max(1, placement.opting_in_eligible) * 100, 1)}% placed "
                    f"({placement.placed_students}/{placement.opting_in_eligible} opting-in of {placement.batch_total} batch), "
                    f"median domestic CTC Rs. {placement.median_ctc_lakhs:.2f} Lakhs"
                )
                if placement
                else "",
            }
            if (brochure_claim_text or placement)
            else None
        ),
    }


async def _authorize_consent_actor(user: CurrentUser, consent_id: str):
    if user.role not in (Role.PARENT.value, Role.STUDENT.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Parent, Student or Admin can manage DPDP consent")
    erp = default_erp_oracle()
    consent = await asyncio.to_thread(erp.get_consent, consent_id, tenant_id=user.tenant_id)
    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found")
    stu = await asyncio.to_thread(erp.get_student, consent.student_prn, tenant_id=user.tenant_id)
    if user.role == Role.PARENT.value:
        if consent.guardian_username != user.username and (not stu or stu.parent_username != user.username):
            raise HTTPException(status_code=403, detail="Parents can manage consent only for their own linked wards")
    elif user.role == Role.STUDENT.value:
        if not stu or stu.prn != user.linked_prn:
            raise HTTPException(status_code=403, detail="Students can manage consent only for their own record")
        if stu.is_minor:
            raise HTTPException(
                status_code=403,
                detail="DPDP_MINOR_GUARDIAN_ONLY: Learners under 18 require verified guardian approval to modify consent.",
            )
    return erp, consent, stu


@router.post("/consents", status_code=201)
async def create_consent(req: CreateConsentRequest, user: CurrentUser):
    """Create a real DPDP data-sharing consent entry for an existing student record."""
    if user.role not in (Role.PARENT.value, Role.ADMIN.value, Role.STUDENT.value):
        raise HTTPException(status_code=403, detail="Only Parent, Student, or Admin can create consent records")
    erp = default_erp_oracle()
    stu = await asyncio.to_thread(erp.get_student, req.student_prn.strip(), tenant_id=user.tenant_id)
    if not stu:
        raise HTTPException(status_code=404, detail=f"Student {req.student_prn!r} not found in ERP")
    if user.role == Role.PARENT.value and stu.parent_username != user.username:
        raise HTTPException(status_code=403, detail="Parents can create consent only for linked wards")
    if user.role == Role.STUDENT.value:
        if stu.prn != user.linked_prn:
            raise HTTPException(status_code=403, detail="Students can create consent only for themselves")
        if stu.is_minor:
            raise HTTPException(
                status_code=403,
                detail="DPDP_MINOR_GUARDIAN_ONLY: Learners under 18 require guardian-created consent.",
            )
    guardian = (
        req.guardian_username.strip()
        or stu.parent_username
        or (user.username if user.role == Role.PARENT.value else "")
    )
    record = DpdpConsentRecord(
        consent_id=f"consent-{uuid.uuid4().hex[:10]}",
        student_prn=stu.prn,
        guardian_username=guardian,
        grantee_name=req.grantee_name.strip(),
        allowed_claims=[k.strip() for k in req.allowed_claims if k.strip()],
        purpose=req.purpose.strip(),
        expires_at=req.expires_at.strip(),
        revoked=req.revoked,
        tenant_id=user.tenant_id,
    )
    saved = await asyncio.to_thread(erp.upsert_consent, record, tenant_id=user.tenant_id)
    return saved.model_dump()


@router.post("/consents/{consent_id}/toggle")
async def toggle_parent_consent(consent_id: str, req: ConsentToggleRequest, user: CurrentUser):
    erp, _consent, _stu = await _authorize_consent_actor(user, consent_id)
    updated = await asyncio.to_thread(erp.set_consent_status, consent_id, revoked=req.revoked, tenant_id=user.tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Consent record not found")
    return updated.model_dump()


@router.post("/consents/{consent_id}/digilocker-init")
async def init_digilocker_consent(consent_id: str, user: CurrentUser):
    """Initialize OAuth 2.0 + RFC 7636 S256 PKCE challenge for live DigiLocker Verified Parental Consent."""
    erp, consent, _stu = await _authorize_consent_actor(user, consent_id)
    cfg = get_settings()
    if not cfg.digilocker_client_id.strip():
        raise HTTPException(
            status_code=501,
            detail="DigiLocker OAuth is not configured on this server (set PRAMAAN_DIGILOCKER_CLIENT_ID).",
        )
    challenge = create_digilocker_pkce_challenge(
        consent_id=consent.consent_id,
        student_prn=consent.student_prn,
        guardian_username=consent.guardian_username,
        secret_key=cfg.secret_key,
        client_id=cfg.digilocker_client_id,
        redirect_uri=cfg.digilocker_redirect_uri,
    )
    await asyncio.to_thread(
        erp.save_pkce_verifier,
        challenge.state,
        expires_at=time.time() + 600.0,
        code_verifier=challenge.code_verifier,
        consent_id=consent.consent_id,
        tenant_id=user.tenant_id,
    )
    return {
        "consent_id": challenge.consent_id,
        "state": challenge.state,
        "code_challenge": challenge.code_challenge,
        "code_challenge_method": challenge.code_challenge_method,
        "authorize_url": challenge.authorize_url,
        "mode": challenge.mode,
        "issued_at": challenge.issued_at,
    }


class DigiLockerVerifyRequest(BaseModel):
    state: str = Field(min_length=8)
    code: str = Field(min_length=2)
    code_verifier: str | None = None


@router.get("/consents/digilocker-callback")
async def digilocker_oauth_callback(
    state: str,
    code: str = "",
):
    """OAuth 2.0 redirect callback target (`PRAMAAN_DIGILOCKER_REDIRECT_URI`) for live DigiLocker VPC."""
    cfg = get_settings()
    if not cfg.digilocker_client_id.strip():
        raise HTTPException(
            status_code=501,
            detail="DigiLocker OAuth is not configured on this server.",
        )
    erp = default_erp_oracle()
    pending = await asyncio.to_thread(erp.pop_pkce_verifier, state)
    if not pending:
        raise HTTPException(status_code=400, detail="Unknown or expired DigiLocker OAuth PKCE state")
    _exp, verifier, expected_cid, tenant_id = pending
    if not code.strip():
        raise HTTPException(status_code=400, detail="Missing DigiLocker OAuth authorization code")
    try:
        receipt = await asyncio.to_thread(
            verify_digilocker_pkce_callback,
            state=state,
            code_verifier=verifier,
            secret_key=cfg.secret_key,
            authorization_code=code,
            client_id=cfg.digilocker_client_id,
            client_secret=cfg.digilocker_client_secret,
            redirect_uri=cfg.digilocker_redirect_uri,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if receipt.consent_id != expected_cid:
        raise HTTPException(status_code=400, detail="DigiLocker OAuth state consent mismatch")

    updated = await asyncio.to_thread(
        erp.record_digilocker_verification,
        receipt.consent_id,
        tx_id=receipt.tx_id,
        verified_at=receipt.verified_at,
        mode=receipt.mode,
        tenant_id=tenant_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Consent record not found")
    return {"consent": updated.model_dump(), "receipt": asdict(receipt)}


@router.post("/consents/{consent_id}/digilocker-verify")
async def verify_digilocker_consent(
    consent_id: str,
    user: CurrentUser,
    req: DigiLockerVerifyRequest,
):
    """Complete live OAuth 2.0 + S256 PKCE DigiLocker Verified Parental Consent (Rule 10)."""
    erp, consent, _stu = await _authorize_consent_actor(user, consent_id)
    cfg = get_settings()
    if not cfg.digilocker_client_id.strip():
        raise HTTPException(
            status_code=501,
            detail="DigiLocker OAuth is not configured on this server (set PRAMAAN_DIGILOCKER_CLIENT_ID).",
        )
    pending = await asyncio.to_thread(erp.pop_pkce_verifier, req.state)
    verifier_token = req.code_verifier or (pending[1] if pending else None)
    if not verifier_token:
        raise HTTPException(status_code=400, detail="Unknown or expired DigiLocker PKCE verifier")
    try:
        receipt = await asyncio.to_thread(
            verify_digilocker_pkce_callback,
            state=req.state,
            code_verifier=verifier_token,
            secret_key=cfg.secret_key,
            authorization_code=req.code,
            client_id=cfg.digilocker_client_id,
            client_secret=cfg.digilocker_client_secret,
            redirect_uri=cfg.digilocker_redirect_uri,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if receipt.consent_id != consent.consent_id:
        raise HTTPException(status_code=400, detail="DigiLocker OAuth state does not match target consent_id")

    updated = await asyncio.to_thread(
        erp.record_digilocker_verification,
        consent.consent_id,
        tx_id=receipt.tx_id,
        verified_at=receipt.verified_at,
        mode=receipt.mode,
        tenant_id=user.tenant_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Consent record not found")
    return {
        "consent": updated.model_dump(),
        "receipt": asdict(receipt),
    }


@router.get("/teacher")
async def get_teacher_portal(user: TeacherOrAdminUser):
    erp = default_erp_oracle()
    min_att, max_cap, cgpa_exempt = await asyncio.to_thread(erp.get_attendance_policy, tenant_id=user.tenant_id)
    faculty = await asyncio.to_thread(erp.list_faculty, tenant_id=user.tenant_id)
    students = await asyncio.to_thread(erp.list_students, tenant_id=user.tenant_id)
    return {
        "faculty": [f.model_dump() for f in faculty],
        "students": [_dump_student_with_cap(s, max_cap) for s in students],
        "min_attendance_pct": min_att,
        "max_medical_condonation_pct": max_cap,
        "cgpa_exemption_threshold": cgpa_exempt,
    }


@router.post("/teacher/audit-condonation")
async def teacher_audit_condonation(req: CondonationAuditRequest, user: TeacherOrAdminUser):
    if user.role not in (Role.TEACHER.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Teacher or Admin can audit attendance condonation")
    erp = default_erp_oracle()
    stu = await asyncio.to_thread(erp.get_student, req.student_prn.strip(), tenant_id=user.tenant_id)
    if not stu:
        raise HTTPException(status_code=404, detail=f"Student {req.student_prn!r} not found in ERP")
    course = next((a for a in stu.attendance if a.course_code == req.course_code.strip()), None)
    if course is None:
        raise HTTPException(
            status_code=404,
            detail=f"No attendance record for course {req.course_code!r} on student {stu.prn!r}",
        )
    min_att, max_cap, cgpa_exempt = await asyncio.to_thread(erp.get_attendance_policy, tenant_id=user.tenant_id)
    raw_pct = course.raw_pct
    proof = await asyncio.to_thread(
        PersistentSmtSolver.prove_attendance_ordinance_z3,
        raw_attendance_pct=raw_pct,
        proposed_condonation_pct=req.proposed_condonation_pct,
        student_cgpa=stu.declared_cgpa,
        min_attendance_pct=min_att,
        max_medical_cap=max_cap,
        cgpa_exemption_threshold=cgpa_exempt,
    )
    compliant = bool(proof["compliant"])
    exempt_by_cgpa = bool(proof["exempt_by_cgpa"])
    meets_floor = bool(proof["meets_attendance_floor"])
    effective = round(min(100.0, raw_pct + min(max_cap, max(0.0, req.proposed_condonation_pct))), 2)
    if exempt_by_cgpa and cgpa_exempt is not None:
        verdict = (
            f"EXEMPT by Z3 SMT: Student CGPA {stu.declared_cgpa:.2f} meets institutional exemption "
            f"threshold (>= {cgpa_exempt:.2f}); {min_att:.1f}% attendance floor is waived."
        )
    elif compliant:
        verdict = (
            f"ALLOWED: {req.proposed_condonation_pct:.1f}% is within institutional {max_cap:.1f}% medical ceiling "
            f"(Effective={effective:.1f}% vs {min_att:.1f}% floor)."
        )
    else:
        verdict = (
            f"BLOCKED by Z3 SMT: {req.proposed_condonation_pct:.1f}% exceeds institutional {max_cap:.1f}% cap "
            f"(Attendance Ordinance §4.2)."
        )
    return {
        "student_prn": stu.prn,
        "course_code": course.course_code,
        "raw_attendance_pct": raw_pct,
        "proposed_condonation_pct": req.proposed_condonation_pct,
        "effective_capped_pct": effective,
        "compliant": compliant,
        "exempt_by_cgpa": exempt_by_cgpa,
        "meets_attendance_floor": meets_floor,
        "min_attendance_pct": min_att,
        "max_medical_condonation_pct": max_cap,
        "cgpa_exemption_threshold": cgpa_exempt,
        "solver_id": str(proof["solver_id"]),
        "witness": proof["witness"],
        "verdict": verdict,
    }


_CANDIDATE_ALLOWED_EXTS = frozenset({".pdf", ".docx", ".txt", ".md"})
_CANDIDATE_MAX_BYTES = 10 * 1024 * 1024
_CANDIDATE_MAX_PAGES = 20
_CANDIDATE_MAX_FILES = 25


async def _read_candidate_upload(upload: UploadFile) -> tuple[str, bytes]:
    filename = Path(upload.filename or "candidate.txt").name
    ext = Path(filename).suffix.lower()
    return await read_bounded_upload(
        upload,
        max_bytes=_CANDIDATE_MAX_BYTES,
        allowed_exts=_CANDIDATE_ALLOWED_EXTS,
        default_filename="candidate.txt",
        require_pdf_magic=ext == ".pdf",
        size_error_detail=f"{filename!r} exceeds 10 MB file size limit",
        ext_error_detail=f"Unsupported file type {ext!r} for {filename!r}. Accepted: .pdf, .docx, .txt, .md",
    )


def _parse_candidate_document(
    filename: str, raw: bytes
) -> tuple[ContentAST, str, list[dict[str, object]], list[tuple[str, bytes]], bool]:
    """Single-pass parser returning (ContentAST, sanitized_visible_text, anomalies, embedded_images, is_pdf)."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        parsed, nodes, visible_parts, _ocr, anomalies_out = build_pdf_text_and_anomaly_nodes(
            raw, extract_images=True, max_pages=_CANDIDATE_MAX_PAGES
        )
        sanitized = "\n\n".join(visible_parts).strip()
        ast = ContentAST(nodes=tuple(nodes), source_filename=filename, raw_content=sanitized)
        return ast, sanitized, anomalies_out, parsed.embedded_image_bytes, True

    ast = default_bundle_parser.parse_one((filename, raw))
    visible_parts = [n.text.strip() for n in ast.nodes if isinstance(n, TextNode) and not n.is_hidden and n.text.strip()]
    anomalies_out = [
        {
            "kind": "hidden_node",
            "page": n.page or 0,
            "snippet": n.text[:160],
            "wcag_contrast": None,
            "effective_font_pt": n.font_size_pt,
            "detail": f"Concealed text node ({n.path})",
        }
        for n in ast.nodes
        if isinstance(n, TextNode) and n.is_hidden and n.text.strip()
    ]
    sanitized = "\n\n".join(visible_parts).strip()
    return ast, sanitized, anomalies_out, [], False


@router.post("/recruiter/batch-audit")
async def recruiter_batch_audit(
    req: RecruiterBatchRequest,
    session: SessionDep,
    user: RecruiterOrAdminUser,
):
    try:
        canon = await resolve_canon_for_tenant(session, req.canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    assets = [
        ((it.name or f"candidate_{i}.md")[:160], it.content[:50_000])
        for i, it in enumerate(req.candidates)
    ]
    # DPDP isolation: external recruiters never query unconsented student PRNs via raw text
    with scoped_erp_lookup("none"):
        job = await default_batch_runner.run_batch(
            canon_id=canon.id, assets=assets, alpha=req.alpha, canon=canon, tenant_id=user.tenant_id
        )
    return {
        "job_id": job.job_id,
        "canon_id": job.canon_id,
        "elapsed_ms": job.elapsed_ms,
        "items": [
            {
                "item_id": it.item_id,
                "filename": it.filename,
                "decision": it.decision,
                "findings_count": it.findings_count,
                "blockers_count": it.blockers_count,
                "warnings_count": it.warnings_count,
                "findings": [f.model_dump(mode="json") for f in it.findings],
            }
            for it in job.items
        ],
    }


@router.post("/recruiter/screen-files")
async def recruiter_screen_files(
    files: Annotated[list[UploadFile], File()],
    session: SessionDep,
    user: RecruiterOrAdminUser,
    canon_id: Annotated[str, Form(max_length=128)] = "pramaan-campus-placement",
    alpha: Annotated[float, Form(ge=0.01, le=0.50)] = 0.10,
    attached_passports_json: Annotated[str, Form(max_length=250_000)] = "{}",
    min_cgpa: Annotated[float | None, Form(ge=0.0, le=10.0)] = None,
    max_backlogs: Annotated[int | None, Form(ge=0, le=50)] = None,
    required_batch_year: Annotated[int | None, Form(ge=1950, le=2100)] = None,
):
    """Multi-file resume screening with Stage 1 forensics, auto-detected QR cross-verification & Drive Eligibility."""
    if not files or len(files) > _CANDIDATE_MAX_FILES:
        raise HTTPException(
            status_code=422,
            detail=f"Upload between 1 and {_CANDIDATE_MAX_FILES} candidate files per screening batch",
        )
    try:
        canon = await resolve_canon_for_tenant(session, canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        raw_attached = json.loads(attached_passports_json or "{}")
        attached_map: dict[str, str] = (
            {str(k): str(v).strip() for k, v in raw_attached.items() if str(v).strip()}
            if isinstance(raw_attached, dict)
            else {}
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid attached_passports_json payload") from exc

    uploads: list[tuple[str, bytes]] = []
    for up in files:
        uploads.append(await _read_candidate_upload(up))

    elig_spec: dict[str, float | int | None] | None = None
    if min_cgpa is not None or max_backlogs is not None or required_batch_year is not None:
        elig_spec = {
            "min_cgpa": min_cgpa,
            "max_backlogs": max_backlogs,
            "required_batch_year": required_batch_year,
        }

    erp = default_erp_oracle()
    sem = asyncio.Semaphore(4)
    t_batch = time.perf_counter()

    async def _screen_one(idx: int, fname: str, raw: bytes) -> dict[str, object]:
        async with sem:
            t0 = time.perf_counter()
            try:
                ast, sanitized_text, anomalies, embedded_imgs, is_pdf = await asyncio.to_thread(
                    _parse_candidate_document, fname, raw
                )
            except Exception as exc:
                # Bulkhead isolation: a single corrupt/malformed file never aborts sibling files in the batch
                return {
                    "item_id": f"file-{idx}-{uuid.uuid4().hex[:6]}",
                    "filename": fname,
                    "decision": "block",
                    "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                    "forensics": {
                        "has_hidden_text": False,
                        "anomalies": [],
                        "visible_preview": f"Unreadable document: {exc}"[:400],
                        "sanitized_text": "",
                    },
                    "embedded_pass": None,
                    "cross_checks": [
                        {
                            "field": "document_parse",
                            "resume_value": "Corrupt or unreadable file",
                            "verified_value": "Valid PDF/DOCX/TXT",
                            "status": "mismatch",
                            "detail": str(exc)[:240],
                        }
                    ],
                    "eligibility": {"active": bool(elig_spec), "passed": False if elig_spec else None, "checks": []},
                    "blockers_count": 1,
                    "warnings_count": 0,
                    "findings_count": 0,
                    "findings": [],
                    "writing_tips": [],
                }

            # Run canon + security checks under DPDP "none" scope, excluding outbound web alt-text check
            with scoped_erp_lookup("none"):
                raw_findings = await run_checks_collect(ast, canon)
            filtered = [f for f in raw_findings if f.check_id != "accessibility.wcag_contrast"]
            cal = default_calibrator.filter_and_calibrate_findings(filtered, alpha=alpha)

            # Resolve attached token or auto-detect embedded QR badge inside PDF
            pass_source: str | None = None
            token = attached_map.get(fname)
            if token:
                pass_source = "attached_token"
            elif is_pdf:
                extracted = await asyncio.to_thread(extract_qr_from_pdf_bytes, raw, embedded_imgs)
                if extracted:
                    token = extracted
                    pass_source = "embedded_pdf_qr"

            embedded_pass_dto: dict[str, object] | None = None
            pass_forged = False
            pass_revoked = False
            verified_claims: dict[str, str] = {}

            if token:
                ver = await asyncio.to_thread(verify_selective_passport_with_ring, token)
                revoked, rev_reason = (
                    await asyncio.to_thread(erp.is_passport_revoked, ver.passport_id)
                    if ver.passport_id
                    else (False, None)
                )
                effective_valid = bool(ver.valid and not revoked)
                pass_forged = not ver.valid
                pass_revoked = bool(revoked)
                if effective_valid:
                    verified_claims = dict(ver.disclosed_claims)
                embedded_pass_dto = {
                    "source": pass_source,
                    "valid": effective_valid,
                    "revoked": revoked,
                    "reason": f"REVOKED: {rev_reason}" if revoked else ver.reason,
                    "passport_id": ver.passport_id,
                    "holder_prn": ver.holder_prn,
                    "root_hash_hex": ver.root_hash_hex,
                    "disclosed_claims": ver.disclosed_claims,
                    "signature_ok": ver.signature_ok,
                    "merkle_proofs_ok": ver.merkle_proofs_ok,
                    "issued_at": ver.issued_at,
                }

            cross_res = cross_verify_resume_against_claims(
                sanitized_text,
                verified_claims,
                eligibility=elig_spec,
            )
            cross_checks = cross_res["checks"]
            cross_has_mismatch = bool(cross_res["has_mismatch"])
            elig_out = cross_res["eligibility"]
            assert isinstance(elig_out, dict)

            writing_tips = [f for f in cal if f.check_id == "voice.readability"]
            actionable = [f for f in cal if f.check_id != "voice.readability"]
            blockers = [f for f in actionable if f.severity >= 50]
            advisories = [f for f in actionable if f.severity < 50]

            has_hidden = bool(anomalies) or any(f.check_id == "security.hidden_text" for f in actionable)

            if pass_forged or pass_revoked or has_hidden or cross_has_mismatch or len(blockers) > 0:
                decision = "block"
            elif (elig_out.get("active") and elig_out.get("passed") is not True) or len(advisories) > 0:
                decision = "needs_review"
            else:
                decision = "allow"

            return {
                "item_id": f"file-{idx}-{uuid.uuid4().hex[:6]}",
                "filename": fname,
                "decision": decision,
                "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                "forensics": {
                    "has_hidden_text": has_hidden,
                    "anomalies": anomalies,
                    "visible_preview": sanitized_text[:400],
                    "sanitized_text": sanitized_text,
                },
                "embedded_pass": embedded_pass_dto,
                "cross_checks": cross_checks,
                "eligibility": elig_out,
                "blockers_count": len(blockers),
                "warnings_count": len(advisories),
                "findings_count": len(actionable),
                "findings": [f.model_dump(mode="json") for f in actionable],
                "writing_tips": [f.model_dump(mode="json") for f in writing_tips],
            }

    items = await asyncio.gather(*(_screen_one(i, fn, raw) for i, (fn, raw) in enumerate(uploads)))
    return {
        "job_id": f"screen-{uuid.uuid4().hex[:10]}",
        "canon_id": canon.id,
        "elapsed_ms": round((time.perf_counter() - t_batch) * 1000.0, 2),
        "items": list(items),
    }


@router.post("/student/preflight")
async def student_resume_preflight(
    file: Annotated[UploadFile, File()],
    session: SessionDep,
    user: CurrentUser,
    canon_id: Annotated[str, Form(max_length=128)] = "pramaan-campus-placement",
    student_prn: Annotated[str, Form(max_length=40)] = "",
):
    """Student Zero-Auto-Reject Pre-Flight Resume Self-Check against own ERP record & Stage 1 PDF forensics."""
    if user.role not in (Role.STUDENT.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Student or Admin can run Pre-Flight Resume Self-Check")
    target_prn = (user.linked_prn if user.role == Role.STUDENT.value else (student_prn or user.linked_prn)).strip()
    if not target_prn:
        raise HTTPException(status_code=422, detail="No linked institutional roll number (PRN) found for this account")

    erp = default_erp_oracle()
    stu = await asyncio.to_thread(erp.get_student, target_prn, tenant_id=user.tenant_id)
    if not stu:
        raise HTTPException(status_code=404, detail=f"Student {target_prn!r} not found in ERP")

    try:
        canon = await resolve_canon_for_tenant(session, canon_id, user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    fname, raw = await _read_candidate_upload(file)
    t0 = time.perf_counter()
    try:
        ast, sanitized_text, anomalies, _imgs, _is_pdf = await asyncio.to_thread(
            _parse_candidate_document, fname, raw
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Strictly restrict Z3 ERP lookups to the logged-in student's OWN PRN
    with scoped_erp_lookup(f"prn:{stu.prn}"):
        raw_findings = await run_checks_collect(ast, canon)
    filtered = [f for f in raw_findings if f.check_id != "accessibility.wcag_contrast"]
    cal = default_calibrator.filter_and_calibrate_findings(filtered, alpha=0.10)

    writing_tips = [f for f in cal if f.check_id == "voice.readability"]
    actionable = [f for f in cal if f.check_id != "voice.readability"]
    blockers = [f for f in actionable if f.severity >= 50]

    # Build authoritative own-ERP claim vector using Z3 credit-weighted CGPA when courses exist
    verified_cgpa = stu.declared_cgpa
    if stu.courses:
        _breach, exact_cgpa, _sid = await asyncio.to_thread(
            PersistentSmtSolver.prove_cgpa_match, stu.declared_cgpa, stu.courses
        )
        if exact_cgpa > 0:
            verified_cgpa = exact_cgpa
    own_claims: dict[str, str] = {
        "full_name": stu.full_name,
        "cgpa": f"{verified_cgpa:.2f}",
        "active_backlogs": str(stu.active_backlogs),
        "batch_year": str(stu.batch_year),
        "program": stu.program,
    }
    cross_res = cross_verify_resume_against_claims(sanitized_text, own_claims)
    erp_checks = cross_res["checks"]
    has_erp_mismatch = bool(cross_res["has_mismatch"])
    has_hidden = bool(anomalies) or any(f.check_id == "security.hidden_text" for f in actionable)

    ready = not has_hidden and not has_erp_mismatch and len(blockers) == 0
    issues_count = (
        len(anomalies)
        + sum(1 for c in erp_checks if isinstance(c, dict) and c.get("status") == "mismatch")
        + len(blockers)
    )
    if ready:
        summary = (
            "Your draft resume passed hidden-text forensics, transcript parity checks, and institutional placement rules. "
            "You can stamp your verified QR pass onto this PDF before applying."
        )
    else:
        summary = (
            f"Found {issues_count} item(s) to review before submitting to recruiters. "
            "Fix highlighted transcript mismatches or concealed template text and re-check."
        )

    return {
        "filename": fname,
        "ready_for_placement": ready,
        "issues_count": issues_count,
        "coaching_summary": summary,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "forensics": {
            "has_hidden_text": has_hidden,
            "anomalies": anomalies,
            "visible_preview": sanitized_text[:400],
            "sanitized_text": sanitized_text,
        },
        "erp_checks": erp_checks,
        "canon_findings": [f.model_dump(mode="json") for f in actionable],
        "writing_tips": [f.model_dump(mode="json") for f in writing_tips],
    }


@router.get("/admin/institutional")
async def get_admin_institutional(user: AdminUser, academic_year: str | None = None):
    erp = default_erp_oracle()
    inst = await asyncio.to_thread(erp.get_institutional_metrics, academic_year, tenant_id=user.tenant_id)
    placement = await asyncio.to_thread(erp.get_placement_record, academic_year, tenant_id=user.tenant_id)
    students_count = await asyncio.to_thread(erp.count_table, "students", tenant_id=user.tenant_id)
    faculty_count = await asyncio.to_thread(erp.count_table, "faculty", tenant_id=user.tenant_id)
    revocations_count = await asyncio.to_thread(erp.count_table, "crl_revocations", tenant_id=user.tenant_id)
    k12 = await asyncio.to_thread(erp.get_k12_school_disclosure, tenant_id=user.tenant_id)
    k12_qc = validate_k12_4gate_qc(k12) if k12 else None

    z3_proofs = None
    if inst is not None:
        heads_sum = round(sum(inst.budget_heads.values()), 2)
        sfr = round(inst.enrolled_learners / max(1, inst.regular_faculty_count), 2)
        sfr_breach, _, _ = await asyncio.to_thread(PersistentSmtSolver.prove_upper_bound_breach, sfr, 15.0)
        total_grants = await asyncio.to_thread(erp.sum_faculty_grants, tenant_id=user.tenant_id)
        z3_proofs = {
            "criterion4_heads_sum_crores": heads_sum,
            "criterion4_declared_crores": inst.criterion4_infra_spend_crores,
            "criterion4_balanced": abs(heads_sum - inst.criterion4_infra_spend_crores) <= 0.01,
            "computed_sfr": sfr,
            "sfr_within_15_to_1": not sfr_breach,
            "total_faculty_grants_lakhs": total_grants,
        }

    z3_k12_proofs = (
        await asyncio.to_thread(
            PersistentSmtSolver.prove_cbse_school_compliance,
            enrolled_students=k12.enrolled_students,
            sections_count=k12.sections_count,
            classroom_area_sqft=k12.classroom_area_sqft,
            classroom_area_sqm=k12.classroom_area_sqm,
            core_teaching_staff=k12.core_teaching_staff,
            max_section_size=k12.max_section_size,
        )
        if k12
        else None
    )
    return {
        "metrics": inst.model_dump() if inst else None,
        "placement": placement.model_dump() if placement else None,
        "z3_proofs": z3_proofs,
        "k12_disclosure": k12.model_dump() if k12 else None,
        "z3_k12_proofs": z3_k12_proofs,
        "k12_qc_report": k12_qc.model_dump() if k12_qc else None,
        "revocations_count": revocations_count,
        "students_count": students_count,
        "faculty_count": faculty_count,
    }


# --- Real Registrar / Admin ERP Write Endpoints ---


@router.post("/admin/students", status_code=201)
async def admin_upsert_student(req: StudentRecord, user: AdminUser):
    saved = await asyncio.to_thread(
        default_erp_oracle().upsert_student,
        req,
        tenant_id=user.tenant_id,
        merge_existing=True,
    )
    return saved.model_dump()


@router.post("/admin/faculty", status_code=201)
async def admin_upsert_faculty(req: FacultyRecord, user: AdminUser):
    saved = await asyncio.to_thread(
        default_erp_oracle().upsert_faculty,
        req,
        tenant_id=user.tenant_id,
        merge_existing=True,
    )
    return saved.model_dump()


@router.post("/admin/institutional", status_code=201)
async def admin_upsert_institutional(req: InstitutionalMetrics, user: AdminUser):
    saved = await asyncio.to_thread(
        default_erp_oracle().upsert_institutional_metrics, req, tenant_id=user.tenant_id
    )
    return saved.model_dump()


@router.post("/admin/placements", status_code=201)
async def admin_upsert_placement(req: PlacementCellRecord, user: AdminUser):
    saved = await asyncio.to_thread(
        default_erp_oracle().upsert_placement_record, req, tenant_id=user.tenant_id
    )
    return saved.model_dump()


@router.post("/admin/k12-school", status_code=201)
async def admin_upsert_k12_school(req: K12SchoolDisclosureRecord, user: AdminUser):
    school, report = await asyncio.to_thread(
        default_erp_oracle().upsert_k12_school_disclosure, req, tenant_id=user.tenant_id
    )
    return {"school": school.model_dump(), "qc_report": report.model_dump()}


@router.get("/admin/bulk-templates/{kind}")
async def download_bulk_csv_template(kind: str, _user: AdminUser):
    """Download an empty, header-only CSV template (zero dummy rows) for bulk SIS roster onboarding."""
    norm = kind.strip().lower()
    if norm == "students":
        return Response(
            content=STUDENTS_CSV_TEMPLATE,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="pramaan-students-template.csv"'},
        )
    if norm == "faculty":
        return Response(
            content=FACULTY_CSV_TEMPLATE,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="pramaan-faculty-template.csv"'},
        )
    raise HTTPException(status_code=404, detail="Template kind must be 'students' or 'faculty'")


async def _run_bulk_csv_import(
    *,
    kind: str,
    file: UploadFile,
    tenant_id: str,
    dry_run: bool,
    skip_invalid: bool,
    parser_fn,
    table_name: str,
    key_col: str,
    key_getter,
    bulk_upsert_fn,
) -> dict[str, object]:
    _, raw = await read_bounded_upload(
        file,
        max_bytes=BULK_CSV_MAX_BYTES,
        allowed_exts=(".csv", ".txt"),
        default_filename="roster.csv",
        allow_empty=True,
        size_error_detail="CSV upload exceeds 5 MB limit",
        ext_error_detail="Upload a UTF-8 .csv file",
    )
    try:
        parsed = await asyncio.to_thread(parser_fn, raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    erp = default_erp_oracle()
    imported_count = 0
    created_count = 0
    updated_count = 0
    committed = False

    if dry_run:
        keys = [key_getter(r) for r in parsed.records]
        existing_keys = await asyncio.to_thread(
            erp.get_existing_keys, table_name, key_col, keys, tenant_id=tenant_id
        )
        updated_count = sum(1 for k in keys if k in existing_keys)
        created_count = len(keys) - updated_count
    else:
        if parsed.error_rows > 0 and not skip_invalid:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"CSV contains {parsed.error_rows} invalid row(s). Fix errors or pass skip_invalid=true "
                    "to import valid rows only."
                ),
            )
        if parsed.records:
            created_count, updated_count = await asyncio.to_thread(
                bulk_upsert_fn, parsed.records, tenant_id=tenant_id
            )
            imported_count = created_count + updated_count
            committed = True

    return {
        "kind": kind,
        "dry_run": dry_run,
        "committed": committed,
        "total_rows": parsed.total_rows,
        "valid_rows": len(parsed.records),
        "error_rows": parsed.error_rows,
        "imported_count": imported_count,
        "created_count": created_count,
        "updated_count": updated_count,
        "preview": summarize_bulk_preview(parsed.records),
        "errors": [asdict(e) for e in parsed.errors],
    }


@router.post("/admin/students/bulk-csv")
async def admin_bulk_import_students(
    file: Annotated[UploadFile, File()],
    user: AdminUser,
    dry_run: Annotated[bool, Form()] = True,
    skip_invalid: Annotated[bool, Form()] = False,
):
    """Validate and optionally commit up to 5,000 student ERP records from a CSV export."""
    return await _run_bulk_csv_import(
        kind="students",
        file=file,
        tenant_id=user.tenant_id,
        dry_run=dry_run,
        skip_invalid=skip_invalid,
        parser_fn=parse_students_csv,
        table_name="students",
        key_col="prn",
        key_getter=lambda r: r.prn.strip(),
        bulk_upsert_fn=default_erp_oracle().bulk_upsert_students,
    )


@router.post("/admin/faculty/bulk-csv")
async def admin_bulk_import_faculty(
    file: Annotated[UploadFile, File()],
    user: AdminUser,
    dry_run: Annotated[bool, Form()] = True,
    skip_invalid: Annotated[bool, Form()] = False,
):
    """Validate and optionally commit up to 5,000 faculty ERP records from a CSV export."""
    return await _run_bulk_csv_import(
        kind="faculty",
        file=file,
        tenant_id=user.tenant_id,
        dry_run=dry_run,
        skip_invalid=skip_invalid,
        parser_fn=parse_faculty_csv,
        table_name="faculty",
        key_col="faculty_id",
        key_getter=lambda r: r.faculty_id.strip(),
        bulk_upsert_fn=default_erp_oracle().bulk_upsert_faculty,
    )
