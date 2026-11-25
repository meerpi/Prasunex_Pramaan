"""SuperJoin-Unified PDF Evidence Ingestion, S1-v2 Forensics & Word-BBox Grounding API."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Header, HTTPException, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from pramaan.api.deps import SessionDep, TeacherOrAdminUser, read_bounded_upload
from pramaan.domain import normalize_temporal, parse_indian_quantity
from pramaan.parsers import (
    extract_tables_adaptive,
    extract_word_bboxes_pdfium,
    ground_quote_on_page,
    inspect_pdf,
    ocr_image_bytes,
    render_page_png,
)
from pramaan.settings import get_settings
from pramaan.store import StoredDocumentRow, repos

router = APIRouter(prefix="/documents", tags=["documents"])

_FACT_LINE_RE = re.compile(
    r"([A-Za-z][A-Za-z0-9 &/\-]{2,48}?)\s*(?:(?:\bis|\bwas|\bstood\s+at|\bstands\s+at|\bverified\s+at|\breached|\breported|\brate|\btotaled|\bclaimed(?:\s+at)?|\bspent|\bof|\bat)\s+|[:=]\s*)"
    r"((?:Rs\.?|INR|₹|\$)?\s*\d[\d,]*(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|lpa|million|%|:\d+)?)",
    re.IGNORECASE,
)
_LEADING_PCT_RE = re.compile(
    r"\b(\d+(?:\.\d+)?\s*%)\s+([A-Za-z][A-Za-z0-9 &/\-]{3,42})",
    re.IGNORECASE,
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<!\bRs\.)(?<!\bDr\.)(?<!\bMr\.)(?<!\bMs\.)(?<!\bNo\.)(?<=[.!?])\s+|\n+")


def _classify_fact_semantics(
    sent: str,
    fallback_subj: str,
    canonical_unit: str,
) -> tuple[str, str, str | None]:
    """Map institutional fact prose to canonical `(subject, predicate, scope)` so cross-doc claims cluster."""
    low = sent.lower()
    if canonical_unit == "%" and "placement" in low:
        return ("CSE Placement Rate", "placement_percentage", None)
    if canonical_unit == "INR" and any(k in low for k in ("median", "ctc", "package", "salary", "lpa")):
        scope = (
            "Including International Stipends"
            if "international" in low
            else ("Domestic Offers Only" if "domestic" in low else None)
        )
        return ("CSE Median Domestic CTC", "median_ctc", scope)
    if canonical_unit == "INR" and any(k in low for k in ("criterion iv", "infrastructure", "infra")):
        return ("NAAC Criterion IV Expenditure", "infra_spend", None)
    if canonical_unit == "ratio" and any(k in low for k in ("teacher", "faculty", "ptr", "sfr")):
        return ("Pupil-Teacher / Faculty Ratio", "pupil_teacher_ratio", None)
    if canonical_unit == "%" and any(k in low for k in ("class x", "class xii", "pass percentage", "board")):
        scope = "Class XII" if "xii" in low else ("Class X" if "class x" in low else None)
        return ("Board Pass Percentage", "board_pass_rate", scope)
    if "campus area" in low:
        return ("Total Campus Area", "campus_area", None)
    if "sanctioned" in low and "intake" in low:
        return ("Sanctioned Intake", "sanctioned_intake", None)
    if "total no. of teachers" in low or "core teaching staff" in low:
        return ("Total Teaching Staff", "teaching_staff", None)
    return (fallback_subj.title(), "reported_metric", None)


def _extract_structured_facts_from_pages(
    doc_id: str,
    filename: str,
    page_texts: dict[int, str],
) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    seen_keys: set[tuple[str, float, str, str | None]] = set()
    for pg, txt in sorted(page_texts.items()):
        # Join soft PDF line wraps right after currency/honorific abbreviations like "Rs.\n3.17"
        norm_txt = re.sub(r"\b(Rs\.|INR|Dr\.|Mr\.|Ms\.|Prof\.)\s*\r?\n\s*", r"\1 ", txt)
        for raw_sent in _SENTENCE_SPLIT_RE.split(norm_txt):
            sent = raw_sent.strip()
            if len(sent) < 12:
                continue
            m = _FACT_LINE_RE.search(sent)
            if m:
                raw_subj = " ".join(m.group(1).split()[-4:])
                val = m.group(2).strip()
            else:
                m_pct = _LEADING_PCT_RE.search(sent)
                if not m_pct:
                    continue
                val = m_pct.group(1).strip()
                raw_subj = " ".join(m_pct.group(2).split()[:4])
            qty = parse_indian_quantity(val)
            if qty is None:
                continue
            subj, pred, scope = _classify_fact_semantics(sent, raw_subj, qty.canonical_unit)
            dedup_key = (pred, round(qty.canonical_value, 4), qty.canonical_unit, scope)
            if pred != "reported_metric" and dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)
            temp_m = re.search(r"\b(?:FY|AY)\s*\d{4}-\d{2}\b", sent, re.IGNORECASE)
            fid = f"{doc_id}-p{pg}-{len(out)}"
            out.append(
                {
                    "fact_id": fid,
                    "subject": subj,
                    "predicate": pred,
                    "value": val,
                    "canonical_value": qty.canonical_value,
                    "canonical_unit": qty.canonical_unit,
                    "temporal": normalize_temporal(temp_m.group(0)) if temp_m else None,
                    "scope": scope,
                    "confidence": 0.92,
                    "provenance": {
                        "doc_id": doc_id,
                        "filename": filename,
                        "page": pg,
                        "evidence_quote": sent[:180],
                        "verified": True,
                        "match_type": "exact",
                    },
                }
            )
    return out


_MAX_SYNC_OCR_PAGES = 20


def _parse_and_enrich_pdf_sync(dest: Path, raw: bytes):
    dest.write_bytes(raw)
    parsed = inspect_pdf(raw, extract_images=False, extract_bboxes=False)
    enriched_pages = dict(parsed.page_texts)
    pre_ocr = {}
    for pg in parsed.scanned_pages[:_MAX_SYNC_OCR_PAGES]:
        png = render_page_png(raw, pg, scale=2.0)
        ocr = ocr_image_bytes(png, sweep_orientations=True)
        pre_ocr[pg] = ocr
        if ocr.full_text.strip():
            enriched_pages[pg] = ocr.full_text.strip()
    for tbl in extract_tables_adaptive(raw, pre_ocr=pre_ocr, skip_ocr=True):
        lin = tbl.to_markdown_linear()
        if lin:
            prev = enriched_pages.get(tbl.page, "")
            enriched_pages[tbl.page] = f"{prev}\n{lin}".strip() if prev else lin
    return parsed, enriched_pages


async def ingest_pdf_bytes(
    session: AsyncSession,
    *,
    doc_id: str,
    safe_base: str,
    upload_root: Path,
    raw: bytes,
    tenant_id: str = "default",
) -> dict[str, object]:
    """Persist PDF bytes safely under `upload_root`, run forensics + OCR/table enrichment, and upsert row."""
    resolved_root = upload_root.resolve()
    resolved_root.mkdir(parents=True, exist_ok=True)
    dest = (resolved_root / f"{doc_id}_{safe_base}").resolve()
    if not dest.is_relative_to(resolved_root):
        raise HTTPException(status_code=400, detail="Unsafe upload path")

    try:
        parsed, enriched_pages = await asyncio.to_thread(_parse_and_enrich_pdf_sync, dest, raw)
    except ValueError as exc:
        dest.unlink(missing_ok=True)
        msg = str(exc)
        status = 413 if ("limit" in msg.lower() or "exceeds" in msg.lower()) else 422
        raise HTTPException(status_code=status, detail=msg) from exc
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Unable to parse PDF document: {exc}") from exc
    facts = _extract_structured_facts_from_pages(doc_id, safe_base, enriched_pages)
    anomalies_payload = [
        {
            "kind": a.kind,
            "page": a.page,
            "snippet": a.snippet,
            "wcag_contrast": a.wcag_contrast,
            "effective_font_pt": a.effective_font_pt,
            "detail": a.detail,
        }
        for a in parsed.anomalies
    ]
    row = StoredDocumentRow(
        doc_id=doc_id,
        tenant_id=tenant_id,
        filename=safe_base,
        filepath=str(dest),
        page_count=parsed.page_count,
        scanned_pages_json=json.dumps(parsed.scanned_pages),
        anomalies_json=json.dumps(anomalies_payload),
        facts_json=json.dumps(facts),
        page_texts_json="{}",
    )
    await repos.save_stored_document(session, row)
    return {
        "doc_id": doc_id,
        "filename": safe_base,
        "page_count": parsed.page_count,
        "scanned_pages": parsed.scanned_pages,
        "anomalies": anomalies_payload,
        "facts_count": len(facts),
        "facts": facts,
    }


_MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024


@router.post("/upload")
async def upload_pdf(
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    user: TeacherOrAdminUser,
):
    """Upload PDF safely (`UUID_name`, streaming 25 MB cap, `%PDF-` header & page limit), inspect anomalies & extract facts."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    raw_name, raw = await read_bounded_upload(
        file,
        max_bytes=_MAX_PDF_UPLOAD_BYTES,
        allowed_exts=(".pdf",),
        require_pdf_magic=True,
        pdf_magic_prefix=b"%PDF-",
        size_error_detail="PDF exceeds 25 MB upload limit",
        ext_error_status=400,
        ext_error_detail="Only PDF files are supported here",
        pdf_error_status=400,
        pdf_error_detail="Invalid PDF file: missing %PDF- magic header",
    )
    safe_base = re.sub(r"[^A-Za-z0-9._\-]", "_", raw_name)

    doc_id = f"doc_{uuid.uuid4().hex[:10]}"
    res = await ingest_pdf_bytes(
        session,
        doc_id=doc_id,
        safe_base=safe_base,
        upload_root=get_settings().upload_dir,
        raw=raw,
        tenant_id=user.tenant_id,
    )
    await session.commit()
    return res


@router.get("")
async def list_documents(session: SessionDep, user: TeacherOrAdminUser):
    rows = await repos.list_stored_documents(session, tenant_id=user.tenant_id)
    return [
        {
            "doc_id": r.doc_id,
            "filename": r.filename,
            "page_count": r.page_count,
            "scanned_pages": json.loads(r.scanned_pages_json),
            "anomalies": json.loads(r.anomalies_json),
            "facts": json.loads(r.facts_json),
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/{doc_id}/forensics")
async def get_document_forensics(doc_id: str, session: SessionDep, user: TeacherOrAdminUser):
    row = await repos.get_stored_document(session, doc_id)
    if not row or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "doc_id": row.doc_id,
        "filename": row.filename,
        "page_count": row.page_count,
        "scanned_pages": json.loads(row.scanned_pages_json),
        "anomalies": json.loads(row.anomalies_json),
        "facts": json.loads(row.facts_json),
    }


@router.get("/{doc_id}/page/{page_num}/image")
async def get_page_image(
    doc_id: str,
    page_num: int,
    session: SessionDep,
    user: TeacherOrAdminUser,
    if_none_match: Annotated[str | None, Header()] = None,
):
    row = await repos.get_stored_document(session, doc_id)
    if not row or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Document not found")
    fpath = Path(row.filepath)
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="PDF file missing on disk")
    stat = fpath.stat()
    etag = f'"{hashlib.sha256(f"{doc_id}:{page_num}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()[:24]}"'
    cache_headers = {"Cache-Control": "private, max-age=3600", "ETag": etag}
    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=304, headers=cache_headers)
    try:
        png = await asyncio.to_thread(render_page_png, fpath, page_num, scale=2.0)
    except IndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png", headers=cache_headers)


@router.get("/{doc_id}/page/{page_num}/bboxes")
async def get_page_bboxes(
    doc_id: str,
    page_num: int,
    session: SessionDep,
    user: TeacherOrAdminUser,
    response: Response,
    quote: Annotated[str | None, Query(max_length=1000)] = None,
):
    row = await repos.get_stored_document(session, doc_id)
    if not row or row.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Document not found")
    fpath = Path(row.filepath)
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="PDF file missing on disk")
    try:
        pw, ph, boxes = await asyncio.to_thread(extract_word_bboxes_pdfium, fpath, page_num)
    except IndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    grounded = await asyncio.to_thread(ground_quote_on_page, quote, boxes) if quote else None
    response.headers["Cache-Control"] = "private, max-age=3600"
    return {
        "doc_id": doc_id,
        "page_num": page_num,
        "page_width": pw,
        "page_height": ph,
        "words": [
            {"word": w.word, "x0": w.x0, "y0": w.y0, "x1": w.x1, "y1": w.y1, "page": w.page}
            for w in boxes
        ],
        "grounded_quote": (
            {
                "found": grounded.found,
                "match_type": grounded.match_type,
                "score": grounded.score,
                "bbox": list(grounded.bbox) if grounded.bbox else None,
                "matched_words": [
                    {"word": w.word, "x0": w.x0, "y0": w.y0, "x1": w.x1, "y1": w.y1, "page": w.page}
                    for w in grounded.matched_words
                ],
            }
            if grounded
            else None
        ),
    }
