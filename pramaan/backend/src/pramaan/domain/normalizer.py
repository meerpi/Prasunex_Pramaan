"""Indian Scale, Monetary, Percentage, and Fiscal/Academic Year Normalizer.

Unifies SuperJoin Fact Knowledge Layer's Indian unit/temporal normalization with
Pramaan's pre-NLI surface canonicalization fix (resolving S4 `e02_year_ay_lakhs_cr`
by converting equivalent Lakh/Crore/Million expressions to shared canonical prose
before DeBERTa cross-encoder inference).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

_SCALE_FACTORS: dict[str, tuple[str, float]] = {
    "crore": ("INR", 1e7),
    "crores": ("INR", 1e7),
    "cr": ("INR", 1e7),
    "lakh": ("INR", 1e5),
    "lakhs": ("INR", 1e5),
    "lac": ("INR", 1e5),
    "lacs": ("INR", 1e5),
    "lpa": ("INR", 1e5),
    "billion": ("unit", 1e9),
    "bn": ("unit", 1e9),
    "million": ("unit", 1e6),
    "mn": ("unit", 1e6),
    "thousand": ("unit", 1e3),
    "k": ("unit", 1e3),
}

_CURRENCY_SCALE_RE = re.compile(
    r"(?:(Rs\.?|INR|USD|\$|₹)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lpa|billion|bn|million|mn|thousand|k)?(?![A-Za-z])(\s*%)?",
    re.IGNORECASE,
)

_TEMPORAL_FY_RE = re.compile(r"\b(FY|AY)\s*[-:]?\s*(\d{2,4})(?:\s*[-/]\s*(\d{2,4}))?\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class NormalizedQuantity:
    raw: str
    numeric_value: float
    scale_power: int
    canonical_value: float
    canonical_unit: str  # "INR" | "USD" | "%" | "ratio" | "scalar"


def parse_indian_quantity(raw: str) -> NormalizedQuantity | None:
    """Parse monetary, Lakh/Crore, percentage, or ratio expressions into SI/INR canonical values."""
    s = raw.strip()
    if not s:
        return None

    # Ratio like "15:1"
    m_ratio = re.fullmatch(r"(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)", s)
    if m_ratio:
        num, den = float(m_ratio.group(1)), float(m_ratio.group(2))
        if den > 0:
            return NormalizedQuantity(s, num / den, 0, num / den, "ratio")

    for m in _CURRENCY_SCALE_RE.finditer(s):
        num_str = m.group(2)
        if not num_str:
            continue
        curr = (m.group(1) or "").strip().lower()
        scale_kw = (m.group(3) or "").strip().lower()
        pct = bool(m.group(4))
        val = float(num_str.replace(",", ""))

        if pct:
            return NormalizedQuantity(s, val, 0, val, "%")

        unit = "USD" if curr in ("$", "usd") else ("INR" if curr in ("rs", "rs.", "inr", "₹") else "scalar")
        mult = 1.0
        pow10 = 0
        if scale_kw in _SCALE_FACTORS:
            inferred_u, mult = _SCALE_FACTORS[scale_kw]
            if unit == "scalar" and inferred_u == "INR":
                unit = "INR"
            pow10 = round(math.log10(mult))
        return NormalizedQuantity(s, val, pow10, val * mult, unit)
    return None


def normalize_temporal(temporal: str | None) -> str | None:
    """Normalize Indian Fiscal Year (`FY`) vs Academic Year (`AY`) distinctly (`FY != AY`)."""
    if not temporal:
        return None
    s = " ".join(temporal.strip().split())
    m = _TEMPORAL_FY_RE.search(s)
    if m:
        kind = m.group(1).upper()
        y1_raw = m.group(2)
        y2_raw = m.group(3)
        y1 = int(y1_raw) if len(y1_raw) == 4 else (2000 + int(y1_raw))
        if y2_raw:
            y2 = int(y2_raw) if len(y2_raw) == 4 else (y1 // 100) * 100 + int(y2_raw)
        else:
            y2 = y1 + 1
        return f"{kind}{y1}-{str(y2)[-2:]}"
    m_yr = re.search(r"\b(20\d{2}|19\d{2})\b", s)
    if m_yr:
        return m_yr.group(1)
    return s.lower()


def pre_canonicalize_nli_text(text: str) -> str:
    """Canonicalize equivalent Indian scale numerals BEFORE DeBERTa-v3 NLI inference.

    Example: `'Rs. 1.50 Crores'` and `'INR 150 Lakhs'` both expand to `'INR 15000000'`
    with normalized `FY`/`AY` tags so surface digit divergence does not spike p_contradiction.
    """
    def _repl_qty(m: re.Match[str]) -> str:
        curr = (m.group(1) or "").strip()
        num_s = m.group(2)
        scale_kw = (m.group(3) or "").strip().lower()
        pct = bool(m.group(4))
        if not scale_kw:
            return m.group(0)
        val = float(num_s.replace(",", ""))
        _, mult = _SCALE_FACTORS[scale_kw]
        canon_v = val * mult
        inferred_u, _ = _SCALE_FACTORS[scale_kw]
        canon_str = f"{int(round(canon_v))}" if abs(canon_v - round(canon_v)) < 1e-6 else f"{canon_v:.2f}"
        suffix = "%" if pct else ""
        if curr.lower() in ("$", "usd"):
            return f"USD {canon_str}{suffix}"
        if curr or inferred_u == "INR":
            return f"INR {canon_str}{suffix}"
        return f"{canon_str}{suffix}"

    out = _CURRENCY_SCALE_RE.sub(_repl_qty, text)
    out = _TEMPORAL_FY_RE.sub(lambda m: normalize_temporal(m.group(0)) or m.group(0), out)
    return out


def quantities_match(q1: NormalizedQuantity, q2: NormalizedQuantity, *, rel_tol: float = 0.015) -> bool:
    """Compare two normalized quantities respecting strict dimension parity, INR Lakh/Crore & tolerance."""
    if q1.canonical_unit != q2.canonical_unit:
        return False
    denom = max(abs(q1.canonical_value), abs(q2.canonical_value), 1e-9)
    return abs(q1.canonical_value - q2.canonical_value) / denom <= rel_tol

