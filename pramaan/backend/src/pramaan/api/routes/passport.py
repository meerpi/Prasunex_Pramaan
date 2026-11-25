"""Stage 4 Salted RFC 9162 Merkle QR Passport Mint, Offline Verification & CRL Revocation Routes."""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from pramaan.api.deps import (
    AdminUser,
    CurrentUser,
    RevocationsViewerUser,
    SlidingWindowRateLimiter,
    read_bounded_upload,
)
from pramaan.domain import Role
from pramaan.erp import default_erp_oracle, is_consent_active
from pramaan.ledger import (
    decode_qr_image_bytes,
    export_sd_jwt_vc,
    load_signing_key_ring,
    mint_selective_passport,
    render_qr_png_bytes,
    rotate_signing_key,
    verify_selective_passport_with_ring,
)
from pramaan.parsers import stamp_qr_onto_pdf

router = APIRouter(prefix="/passport", tags=["passport"])

_MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024
_VERIFY_RATE_LIMITER = SlidingWindowRateLimiter(
    window_s=60.0,
    detail="Too many verification requests. Please wait a minute and try again.",
)


def reset_passport_rate_limiter() -> None:
    _VERIFY_RATE_LIMITER.reset()


def _check_passport_rate_limit(request: Request, action: str, *, max_attempts: int) -> None:
    host = (request.client.host if request.client else "unknown") or "unknown"
    _VERIFY_RATE_LIMITER.check(f"{action}:{host}", max_attempts=max_attempts)


class RotateSigningKeyRequest(BaseModel):
    custom_kid: str = Field(default="", max_length=64)


class MintPassportRequest(BaseModel):
    student_prn: str = Field(default="", max_length=40)
    disclose_keys: list[str] = Field(min_length=1, max_length=20)
    grantee_name: str = Field(min_length=2, max_length=160)


class VerifyPassportRequest(BaseModel):
    payload: str = Field(min_length=4, max_length=16_384)


class RevokePassportRequest(BaseModel):
    passport_id: str = Field(min_length=3, max_length=128)
    reason: str = Field(default="Revoked by holder or institution governance board", max_length=256)


@router.post("/mint")
async def mint_passport(req: MintPassportRequest, user: CurrentUser):
    if user.role not in (Role.STUDENT.value, Role.PARENT.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Student/Parent/Admin can mint identity passport")
    erp = default_erp_oracle()
    prn = (user.linked_prn if user.role == Role.STUDENT.value else req.student_prn).strip()
    if not prn:
        raise HTTPException(status_code=422, detail="Student PRN is required to mint a credential pass")
    stu = await asyncio.to_thread(erp.get_student, prn, tenant_id=user.tenant_id)
    if not stu:
        raise HTTPException(status_code=404, detail=f"Student {prn!r} not found in ERP")
    if user.role == Role.PARENT.value and stu.parent_username != user.username:
        raise HTTPException(status_code=403, detail="Parents can mint credentials only for their linked wards")

    # Enforce DPDP Rules 2025 Rule 10 (<18 verifiable parental consent) with expiry + exact recipient matching
    consents = await asyncio.to_thread(erp.list_consents, student_prn=stu.prn, tenant_id=user.tenant_id)
    grantee_q = req.grantee_name.strip().lower()
    matching_consents = [c for c in consents if c.grantee_name.strip().lower() == grantee_q]
    active_consent = next((c for c in matching_consents if is_consent_active(c)), None)
    if stu.is_minor:
        if active_consent is None:
            has_expired = any(not c.revoked for c in matching_consents)
            reason_note = "has expired" if has_expired else "is missing or revoked"
            raise HTTPException(
                status_code=403,
                detail=(
                    f"DPDP_CONSENT_REQUIRED_UNDER_18: Active, unexpired verifiable guardian consent in Family Hub "
                    f"for exact recipient {req.grantee_name!r} {reason_note} for minor learner {stu.full_name} (Age {stu.age_years})."
                ),
            )
        allowed_set = set(active_consent.allowed_claims)
        disallowed = [k for k in req.disclose_keys if k not in allowed_set]
        if disallowed:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"DPDP_RULE_10_SCOPE_VIOLATION: Guardian consent for {active_consent.grantee_name} "
                    f"excludes claims {disallowed}; allowed claims: {active_consent.allowed_claims}."
                ),
            )
    elif matching_consents and active_consent is None and any(c.revoked for c in matching_consents):
        raise HTTPException(status_code=403, detail=f"DPDP 2025 Guardian Consent revoked for {req.grantee_name}")

    # Populate ONLY genuine claims recorded in ERP — never fabricate attendance or disciplinary standing
    all_claims: dict[str, str] = {
        "full_name": stu.full_name,
        "program": stu.program,
        "batch_year": str(stu.batch_year),
        "cgpa": f"{stu.declared_cgpa:.2f}",
        "active_backlogs": str(stu.active_backlogs),
        "degree_status": stu.degree_status,
    }
    if stu.attendance:
        _, max_cap, _ = await asyncio.to_thread(erp.get_attendance_policy, tenant_id=user.tenant_id)
        avg_att = round(sum(a.effective_pct_for_cap(max_cap) for a in stu.attendance) / len(stu.attendance), 1)
        all_claims["attendance_pct"] = f"{avg_att}%"
    if stu.disciplinary_standing.strip():
        all_claims["disciplinary_standing"] = stu.disciplinary_standing.strip()

    missing_keys = [k for k in req.disclose_keys if k not in all_claims]
    if missing_keys:
        raise HTTPException(
            status_code=422,
            detail=f"Requested attributes unavailable in ERP record: {missing_keys}",
        )

    pid = f"pass-{stu.prn}-{uuid.uuid4().hex[:12]}"
    ring = await asyncio.to_thread(load_signing_key_ring)
    signing_key = ring.active.ed25519_private
    active_kid = ring.active.kid
    minted = await asyncio.to_thread(
        mint_selective_passport,
        passport_id=pid,
        holder_prn=stu.prn,
        all_claims=all_claims,
        disclose_keys=req.disclose_keys,
        signing_key=signing_key,
        key_id=active_kid,
    )
    await asyncio.to_thread(
        erp.record_issued_passport,
        pid,
        stu.prn,
        grantee_name=req.grantee_name.strip(),
        tenant_id=user.tenant_id,
    )
    payload = asdict(minted)
    payload["portability"] = await asyncio.to_thread(export_sd_jwt_vc, minted, signing_key, key_id=active_kid)
    return payload


@router.post("/verify")
async def verify_passport(req: VerifyPassportRequest, request: Request):
    """Offline/edge verifiable endpoint checks Ed25519 signature across active + retired keys, RFC 9162 proofs & CRL."""
    _check_passport_rate_limit(request, "verify", max_attempts=120)
    res = await asyncio.to_thread(verify_selective_passport_with_ring, req.payload)
    revoked, rev_reason = (
        await asyncio.to_thread(default_erp_oracle().is_passport_revoked, res.passport_id)
        if res.passport_id
        else (False, None)
    )
    return {
        "valid": bool(res.valid and not revoked),
        "revoked": revoked,
        "reason": f"REVOKED: {rev_reason}" if revoked else res.reason,
        "passport_id": res.passport_id,
        "holder_prn": res.holder_prn,
        "root_hash_hex": res.root_hash_hex,
        "disclosed_claims": res.disclosed_claims,
        "signature_ok": res.signature_ok,
        "merkle_proofs_ok": res.merkle_proofs_ok,
        "issued_at": res.issued_at,
        "key_id": res.key_id,
    }


@router.post("/verify-image")
async def verify_passport_image(file: Annotated[UploadFile, File()], request: Request):
    _check_passport_rate_limit(request, "verify-image", max_attempts=60)
    _, raw = await read_bounded_upload(
        file,
        max_bytes=_MAX_QR_IMAGE_BYTES,
        default_filename="qr.png",
        size_error_detail="QR image exceeds 10 MB upload limit",
        empty_error_detail="Empty QR image upload",
    )
    try:
        payload = await asyncio.to_thread(decode_qr_image_bytes, raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(payload.strip()) < 4 or len(payload.strip()) > 16_384:
        raise HTTPException(status_code=422, detail="Decoded QR text is not a valid Pramaan credential payload")
    return await verify_passport(VerifyPassportRequest(payload=payload.strip()), request)


@router.post("/revoke")
async def revoke_passport(
    req: RevokePassportRequest,
    user: CurrentUser,
):
    if user.role not in (Role.STUDENT.value, Role.PARENT.value, Role.TEACHER.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Unauthorized to revoke passport")
    erp = default_erp_oracle()
    owner_prn = await asyncio.to_thread(erp.get_passport_owner, req.passport_id, tenant_id=user.tenant_id)
    if not owner_prn:
        raise HTTPException(
            status_code=404,
            detail="Passport was not issued under this institution and cannot be revoked here",
        )
    if user.role == Role.STUDENT.value:
        if not user.linked_prn or owner_prn != user.linked_prn:
            raise HTTPException(status_code=403, detail="Students may revoke only their own credentials")
    elif user.role == Role.PARENT.value:
        stu = await asyncio.to_thread(erp.get_student, owner_prn, tenant_id=user.tenant_id)
        if not stu or stu.parent_username != user.username:
            raise HTTPException(status_code=403, detail="Parents may revoke only linked ward credentials")
    await asyncio.to_thread(erp.revoke_passport, req.passport_id, req.reason, tenant_id=user.tenant_id)
    return {"revoked": True, "passport_id": req.passport_id, "reason": req.reason}


@router.get("/revocations")
async def list_revocations(user: RevocationsViewerUser):
    return {"revocations": await asyncio.to_thread(default_erp_oracle().list_revocations, tenant_id=user.tenant_id)}


@router.get("/keys")
async def list_signing_keys(_user: AdminUser):
    """Return active and retired signing key metadata (public thumbprints only — never private keys)."""
    ring = await asyncio.to_thread(load_signing_key_ring)
    return ring.public_summary()


@router.post("/keys/rotate", status_code=201)
async def rotate_keys(req: RotateSigningKeyRequest, _user: AdminUser):
    """Rotate active Ed25519/ECDSA/JWT signing key while keeping prior keys retired for zero-downtime verification."""
    try:
        ring = await asyncio.to_thread(rotate_signing_key, custom_kid=req.custom_kid)
    except ValueError as exc:
        msg = str(exc)
        status_code = 409 if "already exists" in msg.lower() else 422
        raise HTTPException(status_code=status_code, detail=msg) from exc
    return ring.public_summary()


@router.post("/stamp-pdf")
async def stamp_passport_onto_pdf(
    file: Annotated[UploadFile, File()],
    base45_payload: Annotated[str, Form(min_length=4, max_length=16_384)],
    user: CurrentUser,
):
    """Verify an active, owned Pramaan pass and stamp its crisp QR badge onto Page 1 of an uploaded resume PDF."""
    if user.role not in (Role.STUDENT.value, Role.PARENT.value, Role.ADMIN.value):
        raise HTTPException(status_code=403, detail="Only Student, Parent, or Admin can stamp a verified pass onto a PDF")

    filename, raw_pdf = await read_bounded_upload(
        file,
        max_bytes=_MAX_QR_IMAGE_BYTES,
        allowed_exts=(".pdf",),
        default_filename="resume.pdf",
        require_pdf_magic=True,
        allow_empty=True,
        size_error_detail="PDF exceeds 10 MB upload limit",
        ext_error_detail="Only PDF files can be stamped with a Pramaan QR badge",
        pdf_error_detail="Uploaded file is not a valid PDF document",
    )

    payload = base45_payload.strip()
    verified = await asyncio.to_thread(verify_selective_passport_with_ring, payload)
    if not verified.valid:
        raise HTTPException(status_code=422, detail=f"Invalid or untrusted Pramaan pass payload: {verified.reason}")

    erp = default_erp_oracle()
    revoked, rev_reason = await asyncio.to_thread(erp.is_passport_revoked, verified.passport_id)
    if revoked:
        raise HTTPException(status_code=403, detail=f"Cannot stamp a revoked pass ({rev_reason})")

    issued = await asyncio.to_thread(erp.get_issued_passport, verified.passport_id, tenant_id=user.tenant_id)
    if not issued:
        raise HTTPException(
            status_code=403,
            detail="Pass was not issued for this institution and cannot be stamped here",
        )
    owner_prn, issued_grantee = issued
    if user.role == Role.STUDENT.value and owner_prn != user.linked_prn:
        raise HTTPException(status_code=403, detail="Students may stamp only their own issued passes")

    stu = await asyncio.to_thread(erp.get_student, owner_prn, tenant_id=user.tenant_id)
    if user.role == Role.PARENT.value and (not stu or stu.parent_username != user.username):
        raise HTTPException(status_code=403, detail="Parents may stamp passes only for linked wards")

    # Re-verify live DPDP Rule 10 guardian consent for <18 minors (catches post-mint revocation, expiry & grantee mismatch)
    if stu and stu.is_minor:
        disclosed_keys = set(verified.disclosed_claims.keys())
        consents = await asyncio.to_thread(erp.list_consents, student_prn=stu.prn, tenant_id=user.tenant_id)
        grantee_q = issued_grantee.strip().lower()
        has_covering_consent = any(
            is_consent_active(c)
            and disclosed_keys.issubset(set(c.allowed_claims))
            and (not grantee_q or c.grantee_name.strip().lower() == grantee_q)
            for c in consents
        )
        if not has_covering_consent:
            recipient_msg = f" for recipient {issued_grantee!r}" if issued_grantee else ""
            raise HTTPException(
                status_code=403,
                detail=(
                    f"DPDP_CONSENT_REQUIRED_UNDER_18: Active, unexpired guardian consent{recipient_msg} covering all disclosed claims "
                    f"{sorted(disclosed_keys)} is required before stamping a minor learner's PDF."
                ),
            )

    try:
        qr_png = await asyncio.to_thread(render_qr_png_bytes, payload)
        stamped_pdf = await asyncio.to_thread(stamp_qr_onto_pdf, raw_pdf, qr_png)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    safe_stem = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).stem)[:60] or "resume"
    return Response(
        content=stamped_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_stem}-verified-qr.pdf"'},
    )
