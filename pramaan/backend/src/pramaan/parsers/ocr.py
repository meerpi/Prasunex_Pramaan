"""S2-v2 Degraded-Scan OCR pipeline (OpenCV preprocessing + rotation sweep + RapidOCR / Tesseract)."""

from __future__ import annotations

import io
import logging
import threading
from dataclasses import dataclass

import cv2
import numpy as np
import pytesseract
from PIL import Image

logger = logging.getLogger(__name__)
_MAX_OCR_IMAGE_DIM = 8192
_MAX_OCR_IMAGE_PIXELS = 33_554_432

_RAPID_OCR = None
_RAPID_LOCK = threading.Lock()
_RAPID_INFER_LOCK = threading.Lock()


def _get_rapid_ocr():
    global _RAPID_OCR
    if _RAPID_OCR is not None:
        return _RAPID_OCR if _RAPID_OCR is not False else None
    with _RAPID_LOCK:
        if _RAPID_OCR is None:
            try:
                from rapidocr_onnxruntime import RapidOCR

                _RAPID_OCR = RapidOCR()
            except Exception as exc:
                logger.warning("RapidOCR unavailable (%s); falling back to Tesseract.", exc)
                _RAPID_OCR = False
        return _RAPID_OCR if _RAPID_OCR is not False else None


@dataclass(frozen=True, slots=True)
class OcrLine:
    text: str
    confidence: float
    bbox: tuple[float, float, float, float]


@dataclass(frozen=True, slots=True)
class OcrResult:
    full_text: str
    lines: tuple[OcrLine, ...]
    engine: str
    rotation_deg: int = 0
    mean_confidence: float = 0.0


def preprocess_scan_image(bgr: np.ndarray, *, invert_polarity: bool = False) -> np.ndarray:
    """Enhance washed/low-contrast or dark-banner skewed scans for high-recall OCR."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr.copy()
    if invert_polarity:
        gray = 255 - gray
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    # Adaptive deskew on fine angle range (-12..+12 deg) via minimum-area rect of dark pixels
    _, thresh = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) > 200:
        rect = cv2.minAreaRect(coords[:, ::-1].astype(np.float32))
        angle = rect[-1]
        angle = -(90 + angle) if angle < -45 else -angle
        if 0.5 < abs(angle) <= 15.0:
            h, w = enhanced.shape[:2]
            mat = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
            enhanced = cv2.warpAffine(
                enhanced, mat, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
            )
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def _run_rapid_single(bgr: np.ndarray) -> OcrResult:
    engine = _get_rapid_ocr()
    if engine is None:
        txt = pytesseract.image_to_string(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        lines = tuple(
            OcrLine(text=ln.strip(), confidence=0.75, bbox=(0.0, 0.0, 0.0, 0.0))
            for ln in txt.splitlines()
            if ln.strip()
        )
        return OcrResult(
            full_text="\n".join(ln.text for ln in lines),
            lines=lines,
            engine="tesseract",
            mean_confidence=0.75 if lines else 0.0,
        )

    with _RAPID_INFER_LOCK:
        res, _ = engine(bgr)
    if not res:
        return OcrResult(full_text="", lines=(), engine="rapidocr", mean_confidence=0.0)
    lines: list[OcrLine] = []
    confs: list[float] = []
    for item in res:
        box_pts, text, conf = item[0], str(item[1]).strip(), float(item[2])
        if not text:
            continue
        xs = [float(p[0]) for p in box_pts]
        ys = [float(p[1]) for p in box_pts]
        lines.append(OcrLine(text=text, confidence=conf, bbox=(min(xs), min(ys), max(xs), max(ys))))
        confs.append(conf)
    lines.sort(key=lambda ln: (round(ln.bbox[1] / 12.0), ln.bbox[0]))
    return OcrResult(
        full_text="\n".join(ln.text for ln in lines),
        lines=tuple(lines),
        engine="rapidocr",
        mean_confidence=round(sum(confs) / max(1, len(confs)), 4),
    )


def ocr_image_bytes(raw_bytes: bytes, *, sweep_orientations: bool = True) -> OcrResult:
    """Run S2-v2 OCR with decompression-bomb guard, preprocessing, and 0/90/180/270 orientation recovery."""
    try:
        with Image.open(io.BytesIO(raw_bytes)) as pil_img:
            width, height = pil_img.size
    except Exception:
        return OcrResult(full_text="", lines=(), engine="invalid-image")
    if (
        width <= 0
        or height <= 0
        or width > _MAX_OCR_IMAGE_DIM
        or height > _MAX_OCR_IMAGE_DIM
        or width * height > _MAX_OCR_IMAGE_PIXELS
    ):
        raise ValueError(
            f"OCR image dimensions ({width}x{height}) exceed safety limit ({_MAX_OCR_IMAGE_DIM}x{_MAX_OCR_IMAGE_DIM})"
        )
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return OcrResult(full_text="", lines=(), engine="invalid-image")

    pre = preprocess_scan_image(bgr)
    best = _run_rapid_single(pre)
    # Dark-banner polarity recovery (`v3_clean` promotion): invert dark patches when sparse or dark mean
    if len(best.full_text.strip()) < 24 or float(np.mean(bgr)) < 115.0:
        inv_best = _run_rapid_single(preprocess_scan_image(bgr, invert_polarity=True))
        if (len(inv_best.full_text), inv_best.mean_confidence) > (len(best.full_text), best.mean_confidence):
            best = inv_best
    if not sweep_orientations or (best.mean_confidence >= 0.65 and len(best.full_text.strip()) >= 20):
        return best

    rot_map = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    best_score = len(best.full_text) * best.mean_confidence
    for deg, flag in rot_map.items():
        rotated = cv2.rotate(pre, flag)
        cand = _run_rapid_single(rotated)
        score = len(cand.full_text) * cand.mean_confidence
        if score > best_score * 1.15:
            best = OcrResult(
                full_text=cand.full_text,
                lines=cand.lines,
                engine=cand.engine,
                rotation_deg=deg,
                mean_confidence=cand.mean_confidence,
            )
            best_score = score
    return best
