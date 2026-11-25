"""Permissive PDF parser, S1-v2 hidden-text forensics, word-bbox extractor, and page renderer (pypdfium2 + pypdf)."""

from __future__ import annotations

import contextlib
import io
import math
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import ContentStream

from pramaan.domain import wcag_contrast_ratio
from pramaan.settings import get_settings

_MAX_PDF_EMBEDDED_IMAGES = 12
_MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024
_MAX_RENDER_DIM_PX = 4096
_MAX_XOBJECT_DEPTH = 5
_MAX_STAMP_PDF_BYTES = 10 * 1024 * 1024
# libpdfium is not thread-safe; serialize all PdfDocument operations across worker threads.
_PDFIUM_LOCK = threading.Lock()

_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\u202a-\u202e\u2066-\u2069]")
_DEVANAGARI_VIRAMA_ZWJ_RE = re.compile(r"\u094d[\u200c\u200d]")
_METADATA_INJECTION_RE = re.compile(
    r"(?:\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b|"
    r"\boverride\s+(?:system\s+prompt|governance\s+policy|verdict)\b|"
    r"\bforce\s+verdict\b|"
    r"\brank\s+(?:this\s+)?candidate\b|"
    r"\btop\s+candidate\b|"
    r"\bsystem\s+prompt\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class PdfWordBox:
    word: str
    x0: float
    y0: float
    x1: float
    y1: float
    page: int


@dataclass(frozen=True, slots=True)
class PdfAnomaly:
    kind: str  # "low_contrast" | "ctm_microtext" | "invisible_render_mode" | "form_xobject_hidden" | "zero_width_obfuscation" | "metadata_hidden" | "annotation_hidden"
    page: int
    snippet: str
    wcag_contrast: float | None = None
    effective_font_pt: float | None = None
    detail: str = ""
    raw_text: str = ""


@dataclass(slots=True)
class PdfParseResult:
    page_count: int
    page_texts: dict[int, str] = field(default_factory=dict)
    visible_page_texts: dict[int, str] = field(default_factory=dict)
    page_dimensions: dict[int, tuple[float, float]] = field(default_factory=dict)
    word_boxes: dict[int, list[PdfWordBox]] = field(default_factory=dict)
    scanned_pages: list[int] = field(default_factory=list)
    anomalies: list[PdfAnomaly] = field(default_factory=list)
    embedded_image_bytes: list[tuple[str, bytes]] = field(default_factory=list)


def _decode_pdf_text_operand(operand: Any) -> str:
    if isinstance(operand, bytes):
        return operand.decode("latin-1", errors="ignore")
    if isinstance(operand, str):
        return operand
    if isinstance(operand, list):
        parts: list[str] = []
        for item in operand:
            if isinstance(item, (bytes, str)):
                parts.append(
                    item.decode("latin-1", errors="ignore") if isinstance(item, bytes) else item
                )
        return "".join(parts)
    return str(operand)


def _has_suspicious_zwj(text: str) -> bool:
    """Return True if text contains suspicious zero-width chars outside valid Indic conjuncts."""
    cleaned = _DEVANAGARI_VIRAMA_ZWJ_RE.sub("", text)
    # Also permit emoji ZWJ between pictographs (>= 0x1F300)
    cleaned = re.sub(r"[\U0001F300-\U0001FAFF]\u200d[\U0001F300-\U0001FAFF]", "", cleaned)
    return bool(_ZERO_WIDTH_RE.search(cleaned))


def _scan_stream_for_anomalies(
    stream_obj: Any,
    reader: PdfReader,
    page_idx: int,
    *,
    bg_rgb: tuple[int, int, int] = (255, 255, 255),
    in_form_xobject: bool = False,
) -> list[PdfAnomaly]:
    anomalies: list[PdfAnomaly] = []
    try:
        cs = ContentStream(stream_obj, reader)
    except Exception:
        return anomalies

    gstate_stack: list[
        tuple[
            tuple[float, float, float, float, float, float],
            tuple[float, float, float, float],
            tuple[int, int, int],
            float,
            int,
        ]
    ] = [((1.0, 0.0, 0.0, 1.0, 0.0, 0.0), (1.0, 0.0, 0.0, 1.0), (0, 0, 0), 12.0, 0)]

    for operands, operator in cs.operations:
        op = operator.decode("latin-1", errors="ignore") if isinstance(operator, bytes) else str(operator)
        ctm, tm, fill_rgb, font_size, render_mode = gstate_stack[-1]
        if op == "q":
            gstate_stack.append((ctm, tm, fill_rgb, font_size, render_mode))
        elif op == "Q" and len(gstate_stack) > 1:
            gstate_stack.pop()
        elif op == "BT":
            gstate_stack[-1] = (ctm, (1.0, 0.0, 0.0, 1.0), fill_rgb, font_size, render_mode)
        elif op == "Tm" and len(operands) == 6:
            with contextlib.suppress(Exception):
                ta, tb, tc, td = (float(operands[0]), float(operands[1]), float(operands[2]), float(operands[3]))
                gstate_stack[-1] = (ctm, (ta, tb, tc, td), fill_rgb, font_size, render_mode)
        elif op == "cm" and len(operands) == 6:
            with contextlib.suppress(Exception):
                a, b, c, d, e, f = [float(x) for x in operands]
                pa, pb, pc, pd, pe, pf = ctm
                new_ctm = (
                    pa * a + pb * c,
                    pa * b + pb * d,
                    pc * a + pd * c,
                    pc * b + pd * d,
                    pe * a + pf * c + e,
                    pe * b + pf * d + f,
                )
                gstate_stack[-1] = (new_ctm, tm, fill_rgb, font_size, render_mode)
        elif op == "rg" and len(operands) == 3:
            with contextlib.suppress(Exception):
                r, g, b = [round(float(x) * 255) for x in operands]
                gstate_stack[-1] = (ctm, tm, (r, g, b), font_size, render_mode)
        elif op == "g" and len(operands) == 1:
            with contextlib.suppress(Exception):
                v = round(float(operands[0]) * 255)
                gstate_stack[-1] = (ctm, tm, (v, v, v), font_size, render_mode)
        elif op == "k" and len(operands) == 4:
            with contextlib.suppress(Exception):
                c, m, y, k = [float(x) for x in operands]
                r = round(255 * (1.0 - c) * (1.0 - k))
                g = round(255 * (1.0 - m) * (1.0 - k))
                b = round(255 * (1.0 - y) * (1.0 - k))
                gstate_stack[-1] = (ctm, tm, (r, g, b), font_size, render_mode)
        elif op == "Tf" and len(operands) >= 2:
            with contextlib.suppress(Exception):
                gstate_stack[-1] = (ctm, tm, fill_rgb, abs(float(operands[1])), render_mode)
        elif op == "Tr" and len(operands) >= 1:
            with contextlib.suppress(Exception):
                gstate_stack[-1] = (ctm, tm, fill_rgb, font_size, int(operands[0]))
        elif op in ("Tj", "TJ", "'", '"') and operands:
            txt = _decode_pdf_text_operand(operands[-1 if op == '"' else 0]).strip()
            if not txt:
                continue
            a, b, c, d, _, _ = ctm
            ta, tb, tc, td = tm
            scale_x = math.hypot(a, b) * math.hypot(ta, tb)
            scale_y = math.hypot(c, d) * math.hypot(tc, td)
            eff_pt = font_size * max(min(scale_x, scale_y), 0.0)
            ratio = wcag_contrast_ratio(fill_rgb, bg_rgb)

            if render_mode == 3:
                anomalies.append(
                    PdfAnomaly(
                        kind="invisible_render_mode",
                        page=page_idx,
                        snippet=txt[:160],
                        detail="PDF text render mode 3 Tr (invisible text layer)",
                        raw_text=txt[:4000],
                    )
                )
            elif ratio < 1.80:
                anomalies.append(
                    PdfAnomaly(
                        kind="form_xobject_hidden" if in_form_xobject else "low_contrast",
                        page=page_idx,
                        snippet=txt[:160],
                        wcag_contrast=round(ratio, 3),
                        effective_font_pt=round(eff_pt, 2),
                        detail=f"Text WCAG contrast {ratio:.2f} < 1.80 on page background",
                        raw_text=txt[:4000],
                    )
                )
            elif eff_pt < 3.0:
                anomalies.append(
                    PdfAnomaly(
                        kind="ctm_microtext",
                        page=page_idx,
                        snippet=txt[:160],
                        wcag_contrast=round(ratio, 3),
                        effective_font_pt=round(eff_pt, 2),
                        detail=f"Effective font height {eff_pt:.2f}pt (< 3.0pt CTM/zero-pt microtext)",
                        raw_text=txt[:4000],
                    )
                )
            if _has_suspicious_zwj(txt):
                anomalies.append(
                    PdfAnomaly(
                        kind="zero_width_obfuscation",
                        page=page_idx,
                        snippet=txt[:160],
                        detail="Zero-width or BiDi stealth characters inside PDF text",
                        raw_text=txt[:4000],
                    )
                )

    return anomalies


def _load_pdf_bytes(source: Path | bytes) -> bytes:
    if isinstance(source, bytes):
        return source
    return Path(source).read_bytes()


def _extract_word_bboxes_from_page(page, page_num: int) -> tuple[float, float, list[PdfWordBox]]:
    pw, ph = page.get_size()
    tp = page.get_textpage()
    n_chars = tp.count_chars()
    words: list[PdfWordBox] = []
    buf_chars: list[str] = []
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")

    def _flush() -> None:
        nonlocal x0, y0, x1, y1
        token = "".join(buf_chars).strip()
        buf_chars.clear()
        if token and x0 < x1 and y0 < y1:
            words.append(
                PdfWordBox(
                    word=token,
                    x0=round(x0, 2),
                    y0=round(y0, 2),
                    x1=round(x1, 2),
                    y1=round(y1, 2),
                    page=page_num,
                )
            )
        x0 = y0 = float("inf")
        x1 = y1 = float("-inf")

    for i in range(n_chars):
        ch = tp.get_text_range(i, 1)
        if not ch or ch.isspace():
            _flush()
            continue
        try:
            left, bottom, right, top = tp.get_charbox(i, loose=False)
        except Exception:
            buf_chars.append(ch)
            continue
        tl_y0 = max(0.0, ph - top)
        tl_y1 = max(tl_y0 + 0.5, ph - bottom)
        buf_chars.append(ch)
        x0 = min(x0, left)
        y0 = min(y0, tl_y0)
        x1 = max(x1, right)
        y1 = max(y1, tl_y1)
    _flush()
    return float(pw), float(ph), words


_BBOX_CACHE_LOCK = threading.Lock()
_BBOX_CACHE_MAX = 64
_BBOX_CACHE: OrderedDict[tuple[str, int, int, int], tuple[float, float, list[PdfWordBox]]] = OrderedDict()


def extract_word_bboxes_pdfium(source: Path | bytes, page_num: int) -> tuple[float, float, list[PdfWordBox]]:
    """Extract top-left origin word bounding boxes for `page_num` using pypdfium2 (cached per file+page)."""
    cache_key: tuple[str, int, int, int] | None = None
    if isinstance(source, Path):
        st = source.stat()
        cache_key = (str(source.resolve()), st.st_mtime_ns, st.st_size, page_num)
        with _BBOX_CACHE_LOCK:
            hit = _BBOX_CACHE.get(cache_key)
            if hit is not None:
                _BBOX_CACHE.move_to_end(cache_key)
                return hit[0], hit[1], list(hit[2])

    raw = _load_pdf_bytes(source)
    with _PDFIUM_LOCK:
        try:
            doc = pdfium.PdfDocument(raw)
        except Exception as exc:
            raise ValueError(f"Corrupt or unreadable PDF document: {exc}") from exc
        try:
            if page_num < 0 or page_num >= len(doc):
                raise IndexError(f"Page {page_num} out of bounds (0..{len(doc) - 1})")
            res = _extract_word_bboxes_from_page(doc[page_num], page_num)
        finally:
            doc.close()

    if cache_key is not None:
        with _BBOX_CACHE_LOCK:
            _BBOX_CACHE[cache_key] = (res[0], res[1], list(res[2]))
            _BBOX_CACHE.move_to_end(cache_key)
            while len(_BBOX_CACHE) > _BBOX_CACHE_MAX:
                _BBOX_CACHE.popitem(last=False)
    return res


def render_page_png(source: Path | bytes, page_num: int, *, scale: float = 2.0) -> bytes:
    """Render PDF page as PNG bytes using permissive pypdfium2 with max-dimension bomb guard."""
    raw = _load_pdf_bytes(source)
    with _PDFIUM_LOCK:
        try:
            doc = pdfium.PdfDocument(raw)
        except Exception as exc:
            raise ValueError(f"Corrupt or unreadable PDF document: {exc}") from exc
        try:
            if page_num < 0 or page_num >= len(doc):
                raise IndexError(f"Page {page_num} out of bounds")
            page = doc[page_num]
            pw, ph = page.get_size()
            max_side = max(1.0, float(pw), float(ph))
            safe_scale = min(max(0.25, float(scale)), _MAX_RENDER_DIM_PX / max_side)
            pil_img = page.render(scale=safe_scale).to_pil()
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            doc.close()


def _scan_form_xobjects_recursive(
    resources: Any,
    reader: PdfReader,
    page_idx: int,
    *,
    seen_ids: set[int],
    depth: int = 0,
) -> list[PdfAnomaly]:
    if not resources or depth >= _MAX_XOBJECT_DEPTH:
        return []
    out: list[PdfAnomaly] = []
    with contextlib.suppress(Exception):
        res_obj = resources.get_object() if hasattr(resources, "get_object") else resources
        if not isinstance(res_obj, dict) or "/XObject" not in res_obj:
            return out
        xobjs = res_obj["/XObject"].get_object()
        if not isinstance(xobjs, dict):
            return out
        for _name, ref in xobjs.items():
            obj = ref.get_object() if hasattr(ref, "get_object") else ref
            oid = id(obj)
            if oid in seen_ids:
                continue
            seen_ids.add(oid)
            if str(obj.get("/Subtype", "")) == "/Form":
                out.extend(_scan_stream_for_anomalies(obj, reader, page_idx, in_form_xobject=True))
                nested_res = obj.get("/Resources")
                if nested_res:
                    out.extend(
                        _scan_form_xobjects_recursive(
                            nested_res, reader, page_idx, seen_ids=seen_ids, depth=depth + 1
                        )
                    )
    return out


def inspect_pdf(
    source: Path | bytes,
    *,
    extract_images: bool = True,
    extract_bboxes: bool = True,
    max_pages: int | None = None,
) -> PdfParseResult:
    """Parse PDF pages, optional word bboxes in one open, scanned-page mask, and S1-v2 anomalies."""
    raw = _load_pdf_bytes(source)
    page_limit = max_pages if max_pages is not None else get_settings().max_pdf_pages
    result = PdfParseResult(page_count=0)

    # 1. Text, dimensions, and optional word bboxes in a SINGLE pypdfium2 document open
    with _PDFIUM_LOCK:
        try:
            fdoc = pdfium.PdfDocument(raw)
        except Exception as exc:
            raise ValueError(f"Corrupt or unreadable PDF document: {exc}") from exc
        try:
            result.page_count = len(fdoc)
            if page_limit > 0 and result.page_count > page_limit:
                raise ValueError(f"PDF page count ({result.page_count}) exceeds safety limit of {page_limit} pages")
            for p_idx in range(len(fdoc)):
                page = fdoc[p_idx]
                pw, ph = page.get_size()
                tp = page.get_textpage()
                txt = tp.get_text_range() or ""
                result.page_texts[p_idx] = txt
                result.page_dimensions[p_idx] = (float(pw), float(ph))
                if len(txt.strip()) < 20:
                    result.scanned_pages.append(p_idx)
                if extract_bboxes:
                    _, _, wboxes = _extract_word_bboxes_from_page(page, p_idx)
                    result.word_boxes[p_idx] = wboxes
        finally:
            fdoc.close()

    # 2. S1-v2 CTM / WCAG / Tr / Nested Form XObject + Metadata / Annotation forensics + bounded image extraction
    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError(f"Corrupt or unreadable PDF structure: {exc}") from exc

    # 2a. PDF /Info metadata prompt-injection & keyword-stuffing inspection
    meta = reader.metadata
    if meta:
        for key in ("/Keywords", "/Subject", "/Author", "/Title"):
            raw_val = meta.get(key)
            if not raw_val:
                continue
            val = str(raw_val).strip()
            if not val:
                continue
            if _METADATA_INJECTION_RE.search(val) or _has_suspicious_zwj(val) or (key == "/Keywords" and len(val) > 300):
                result.anomalies.append(
                    PdfAnomaly(
                        kind="metadata_hidden",
                        page=0,
                        snippet=f"{key}: {val}"[:160],
                        detail=f"Suspicious hidden payload in PDF metadata field {key}",
                        raw_text=val[:4000],
                    )
                )

    img_count = 0
    for p_idx, page in enumerate(reader.pages):
        contents = page.get_contents()
        if contents is not None:
            result.anomalies.extend(_scan_stream_for_anomalies(contents, reader, p_idx))

        # 2b. PDF page /Annots hidden comment / prompt-injection inspection
        annots = page.get("/Annots")
        if annots:
            with contextlib.suppress(Exception):
                annot_list = annots.get_object() if hasattr(annots, "get_object") else annots
                if isinstance(annot_list, list):
                    for a_ref in annot_list[:40]:
                        a_obj = a_ref.get_object() if hasattr(a_ref, "get_object") else a_ref
                        if not isinstance(a_obj, dict):
                            continue
                        a_text = str(a_obj.get("/Contents") or "").strip()
                        if not a_text:
                            continue
                        flags = int(a_obj.get("/F") or 0)
                        is_hidden_flag = bool(flags & 2) or bool(flags & 32)
                        if is_hidden_flag or _METADATA_INJECTION_RE.search(a_text) or _has_suspicious_zwj(a_text):
                            result.anomalies.append(
                                PdfAnomaly(
                                    kind="annotation_hidden",
                                    page=p_idx,
                                    snippet=a_text[:160],
                                    detail="Hidden or adversarial PDF annotation comment",
                                    raw_text=a_text[:4000],
                                )
                            )

        resources = page.get("/Resources")
        if resources:
            result.anomalies.extend(
                _scan_form_xobjects_recursive(resources, reader, p_idx, seen_ids=set())
            )
            if extract_images and img_count < _MAX_PDF_EMBEDDED_IMAGES:
                with contextlib.suppress(Exception):
                    res_obj = resources.get_object() if hasattr(resources, "get_object") else resources
                    xobjs = res_obj.get("/XObject").get_object() if (isinstance(res_obj, dict) and "/XObject" in res_obj) else None
                    has_safe_img = False
                    if isinstance(xobjs, dict):
                        for _xname, xref in xobjs.items():
                            xobj = xref.get_object() if hasattr(xref, "get_object") else xref
                            if str(xobj.get("/Subtype", "")) == "/Image":
                                iw = int(xobj.get("/Width") or 0)
                                ih = int(xobj.get("/Height") or 0)
                                if 0 < iw <= _MAX_RENDER_DIM_PX and 0 < ih <= _MAX_RENDER_DIM_PX and iw * ih <= 16_777_216:
                                    has_safe_img = True
                                    break
                    if has_safe_img:
                        for img_file in page.images:
                            if img_count >= _MAX_PDF_EMBEDDED_IMAGES:
                                break
                            data = img_file.data
                            if data and len(data) <= _MAX_EMBEDDED_IMAGE_BYTES:
                                result.embedded_image_bytes.append((img_file.name, data))
                                img_count += 1

    # 3. Channel-separated visible-only text (strip hidden layer spans + suspicious zero-width chars)
    hidden_kinds = frozenset({"low_contrast", "ctm_microtext", "invisible_render_mode", "form_xobject_hidden"})
    anoms_by_page: dict[int, list[str]] = {}
    for anom in result.anomalies:
        if anom.kind in hidden_kinds:
            payload = (anom.raw_text or anom.snippet).strip()
            if payload:
                anoms_by_page.setdefault(anom.page, []).append(payload)

    for p_idx, page_txt in result.page_texts.items():
        clean = page_txt
        for hidden_str in sorted(anoms_by_page.get(p_idx, ()), key=len, reverse=True):
            if hidden_str in clean:
                clean = clean.replace(hidden_str, "")
            else:
                tokens = [re.escape(tok) for tok in hidden_str.split() if tok]
                if tokens:
                    clean = re.sub(r"\s+".join(tokens), "", clean)
        clean = _strip_suspicious_zwj(clean)
        clean = re.sub(r"[ \t]+\n", "\n", clean)
        clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
        result.visible_page_texts[p_idx] = clean

    return result


def _strip_suspicious_zwj(text: str) -> str:
    """Remove suspicious zero-width / BiDi chars while preserving valid Devanagari virama conjuncts."""
    placeholder = "\x00VIRAMA_ZWJ\x00"
    protected = _DEVANAGARI_VIRAMA_ZWJ_RE.sub(lambda m: f"{placeholder}{ord(m.group(0)[1])}\x00", text)
    cleaned = _ZERO_WIDTH_RE.sub("", protected)
    return re.sub(
        r"\x00VIRAMA_ZWJ\x00(\d+)\x00",
        lambda m: "\u094d" + chr(int(m.group(1))),
        cleaned,
    )


def stamp_qr_onto_pdf(pdf_bytes: bytes, qr_png_bytes: bytes) -> bytes:
    """Stamp a crisp vector-safe QR badge onto the top-right corner of Page 1 without rasterizing resume text."""
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        raise ValueError("Uploaded file is not a valid PDF document")
    if len(pdf_bytes) > _MAX_STAMP_PDF_BYTES:
        raise ValueError("PDF exceeds 10 MB safety limit")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:
        raise ValueError(f"Corrupt or unreadable PDF document: {exc}") from exc
    max_pages = get_settings().max_pdf_pages
    if len(reader.pages) == 0:
        raise ValueError("PDF contains zero pages")
    if max_pages > 0 and len(reader.pages) > max_pages:
        raise ValueError(f"PDF page count ({len(reader.pages)}) exceeds safety limit ({max_pages})")

    with Image.open(io.BytesIO(qr_png_bytes)) as raw_qr:
        qr_px_w = raw_qr.width
        qr_rgb = raw_qr.convert("RGB")
        framed = ImageOps.expand(qr_rgb, border=12, fill="#FFFFFF")
        framed = ImageOps.expand(framed, border=3, fill="#171614")
        stamp_buf = io.BytesIO()
        framed.save(stamp_buf, format="PDF", resolution=300.0)

    stamp_buf.seek(0)
    stamp_page = PdfReader(stamp_buf).pages[0]
    sw = max(1.0, float(stamp_page.mediabox.width))
    sh = max(1.0, float(stamp_page.mediabox.height))

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    page0 = writer.pages[0]
    if getattr(page0, "rotation", 0):
        with contextlib.suppress(Exception):
            page0.transfer_rotation_to_content()
    box = page0.cropbox if page0.cropbox is not None else page0.mediabox
    pw = max(1.0, float(box.width))
    ph = max(1.0, float(box.height))
    # Give dense multi-claim QR badges (>= version ~14) slightly larger footprint so rasterized fallback decodes cleanly
    dense_qr = qr_px_w >= 560
    max_badge = 108.0 if dense_qr else 84.0
    min_badge = 74.0 if dense_qr else 56.0
    badge_pt = max(min_badge, min(max_badge, pw * 0.20, ph * 0.20))
    scale = badge_pt / max(sw, sh)
    margin = 14.0
    tx = float(box.right) - (sw * scale) - margin
    ty = float(box.top) - (sh * scale) - margin
    page0.merge_transformed_page(
        stamp_page,
        Transformation().scale(scale, scale).translate(tx, ty),
    )
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build_pdf_text_and_anomaly_nodes(
    raw: bytes,
    *,
    extract_images: bool = True,
    max_pages: int | None = None,
) -> tuple[PdfParseResult, list[Any], list[str], dict[int, Any], list[dict[str, object]]]:
    """Shared channel-separated PDF visible-text + OCR fallback + hidden anomaly node builder.

    Returns `(parsed, nodes, visible_parts, ocr_by_page, anomalies_dicts)` using `visible_page_texts`
    so concealed white-text/microtext never bleeds into visible document AST nodes.
    """
    from pramaan.domain.ast import Node, TextNode
    from pramaan.parsers.ocr import ocr_image_bytes

    parsed = inspect_pdf(raw, extract_images=extract_images, extract_bboxes=False, max_pages=max_pages)
    nodes: list[Node] = []
    visible_parts: list[str] = []
    ocr_by_page: dict[int, Any] = {}

    for pg, txt in sorted(parsed.page_texts.items()):
        clean_vis = (parsed.visible_page_texts.get(pg) or "").strip()
        if len(txt.strip()) >= 20:
            if clean_vis:
                nodes.append(TextNode.from_text(clean_vis, path=f"pdf/p[{pg}]", page=pg))
                visible_parts.append(clean_vis)
        else:
            png = render_page_png(raw, pg, scale=2.0)
            ocr = ocr_image_bytes(png, sweep_orientations=True)
            ocr_by_page[pg] = ocr
            ocr_txt = ocr.full_text.strip()
            if ocr_txt:
                nodes.append(TextNode.from_text(ocr_txt, path=f"pdf/ocr[{pg}]", page=pg))
                visible_parts.append(ocr_txt)

    anomalies_out: list[dict[str, object]] = []
    for anom in parsed.anomalies:
        nodes.append(
            TextNode.from_text(
                anom.raw_text or anom.snippet,
                path=f"pdf/anomaly[{anom.kind}:{anom.page}]",
                page=anom.page,
                font_size_pt=anom.effective_font_pt,
                is_hidden=True,
            )
        )
        anomalies_out.append(
            {
                "kind": anom.kind,
                "page": anom.page,
                "snippet": anom.snippet,
                "wcag_contrast": anom.wcag_contrast,
                "effective_font_pt": anom.effective_font_pt,
                "detail": anom.detail,
            }
        )

    return parsed, nodes, visible_parts, ocr_by_page, anomalies_out
