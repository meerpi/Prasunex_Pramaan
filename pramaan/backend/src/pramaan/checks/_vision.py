"""Shared colourimetric (CIE Lab / CIEDE2000), WCAG 2.1, and image utilities inside `pramaan.checks`."""

from __future__ import annotations

import math
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from pramaan.domain import relative_luminance as relative_luminance
from pramaan.domain import wcag_contrast_ratio as wcag_contrast_ratio
from pramaan.settings import get_settings


def _is_safe_image_path(p: Path) -> bool:
    if ".." in p.parts:
        return False
    try:
        resolved = p.resolve()
        allowed_roots = (
            get_settings().upload_dir.resolve(),
            Path(tempfile.gettempdir()).resolve(),
        )
        return any(resolved.is_relative_to(root) for root in allowed_roots)
    except OSError:
        return False


@lru_cache(maxsize=64)
def _load_rgb_cached(resolved: str, mtime_ns: int, size: int) -> np.ndarray | None:
    try:
        with Image.open(resolved) as im:
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                rgba = im.convert("RGBA")
                bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                rgb = Image.alpha_composite(bg, rgba).convert("RGB")
            else:
                rgb = im.convert("RGB")
            arr = np.asarray(rgb, dtype=np.uint8)
            arr.setflags(write=False)
            return arr
    except Exception:
        return None


def load_rgb_image(path: str | Path) -> np.ndarray | None:
    if not path:
        return None
    p = Path(path)
    if not _is_safe_image_path(p):
        return None
    try:
        st = p.stat()
    except OSError:
        return None
    if not p.is_file():
        return None
    return _load_rgb_cached(str(p.resolve()), st.st_mtime_ns, st.st_size)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, round(c))) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    lin = [(c / 255.0) / 12.92 if (c / 255.0) <= 0.04045 else (((c / 255.0) + 0.055) / 1.055) ** 2.4 for c in rgb]
    x = (0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2]) / 0.95047
    y = (0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.0721750 * lin[2]) / 1.00000
    z = (0.0193339 * lin[0] + 0.1191920 * lin[1] + 0.9503041 * lin[2]) / 1.08883
    eps = 216.0 / 24389.0
    kap = 24389.0 / 27.0

    def _f(t: float) -> float:
        return math.cbrt(t) if t > eps else (kap * t + 16.0) / 116.0

    fx, fy, fz = _f(x), _f(y), _f(z)
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


def delta_e_ciede2000(lab1: tuple[float, float, float], lab2: tuple[float, float, float]) -> float:
    """Sharma-Wu-Dalal (2005) CIEDE2000 colour difference."""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    c_bar = 0.5 * (c1 + c2)
    c7 = c_bar**7
    g = 0.5 * (1.0 - math.sqrt(c7 / (c7 + 25.0**7)))
    a1p, a2p = (1.0 + g) * a1, (1.0 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360.0 if (c1p != 0.0) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360.0 if (c2p != 0.0) else 0.0
    dl = l2 - l1
    dc = c2p - c1p
    if c1p * c2p == 0.0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180.0:
        dhp = h2p - h1p
    elif h2p - h1p > 180.0:
        dhp = h2p - h1p - 360.0
    else:
        dhp = h2p - h1p + 360.0
    dh = 2.0 * math.sqrt(c1p * c2p) * math.sin(math.radians(dhp / 2.0))
    l_bar = 0.5 * (l1 + l2)
    cp_bar = 0.5 * (c1p + c2p)
    if c1p * c2p == 0.0:
        hp_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        hp_bar = 0.5 * (h1p + h2p)
    elif h1p + h2p < 360.0:
        hp_bar = 0.5 * (h1p + h2p + 360.0)
    else:
        hp_bar = 0.5 * (h1p + h2p - 360.0)
    t = (
        1.0
        - 0.17 * math.cos(math.radians(hp_bar - 30.0))
        + 0.24 * math.cos(math.radians(2.0 * hp_bar))
        + 0.32 * math.cos(math.radians(3.0 * hp_bar + 6.0))
        - 0.20 * math.cos(math.radians(4.0 * hp_bar - 63.0))
    )
    dtheta = 30.0 * math.exp(-(((hp_bar - 275.0) / 25.0) ** 2))
    cp7 = cp_bar**7
    rc = 2.0 * math.sqrt(cp7 / (cp7 + 25.0**7))
    l50 = (l_bar - 50.0) ** 2
    sl = 1.0 + (0.015 * l50) / math.sqrt(20.0 + l50)
    sc = 1.0 + 0.045 * cp_bar
    sh = 1.0 + 0.015 * cp_bar * t
    rt = -math.sin(math.radians(2.0 * dtheta)) * rc
    return math.sqrt(
        (dl / sl) ** 2 + (dc / sc) ** 2 + (dh / sh) ** 2 + rt * (dc / sc) * (dh / sh)
    )

