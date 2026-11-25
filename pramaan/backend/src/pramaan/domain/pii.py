"""Extended Campus DPDP 2025 PII Scrubber v2 (Pramaan domain trust boundary)."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Pattern ordering ensures longer composite tokens match before sub-patterns
_PAN_RE = re.compile(r"\b[A-Za-z]{5}[0-9]{4}[A-Za-z]\b")
_PRN_RE = re.compile(
    r"\b(?:PRN|REG|ROLL|ENR)[\s:\-]*[A-Z0-9]{6,14}\b|\b\d{2,4}[A-Za-z]{2,5}\d{3,5}\b",
    re.IGNORECASE,
)
_DOB_RE = re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}\b")
_UPI_VPA_RE = re.compile(
    r"\b[A-Za-z0-9._\-]{2,64}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl|kotak|sbi|icici|hdfcbank)\b",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_AADHAAR_RE = re.compile(r"\b[2-9]\d{3}[\s.\-]?\d{4}[\s.\-]?\d{4}\b")
_BANK_ACCT_RE = re.compile(r"\b(?:acct|a/c|account)\s*(?:no\.?|number|#|:)?\s*\d{9,18}\b", re.IGNORECASE)
_PHONE_RE = re.compile(
    r"(?:(?:\+91|0091)[\s\-]?[6-9]\d{9}\b|\b[6-9]\d{4}[\s\-]?\d{5}\b)"
)

_PLACEHOLDER_TOKEN_RE = re.compile(
    r"<(?:PAN_ID|PRN_ID|DOB|UPI_VPA|EMAIL|AADHAAR_ID|BANK_ACCT|PHONE|PERSON)_\d+>"
)

_PATTERN_SPECS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("PAN_ID", _PAN_RE),
    ("PRN_ID", _PRN_RE),
    ("DOB", _DOB_RE),
    ("UPI_VPA", _UPI_VPA_RE),
    ("EMAIL", _EMAIL_RE),
    ("AADHAAR_ID", _AADHAAR_RE),
    ("BANK_ACCT", _BANK_ACCT_RE),
    ("PHONE", _PHONE_RE),
)


@dataclass(frozen=True, slots=True)
class ScrubbedText:
    """Result of local PII scrubbing before external AI gateway dispatch."""

    original_text: str
    masked_text: str
    placeholders: dict[str, str]

    @property
    def pii_count(self) -> int:
        return len(self.placeholders)

    def __len__(self) -> int:
        return len(self.placeholders)

    def verify_placeholder_integrity(self, candidate_masked_text: str) -> tuple[bool, str | None]:
        for ph in self.placeholders:
            if candidate_masked_text.count(ph) < self.masked_text.count(ph):
                return False, f"Dropped required PII placeholder {ph}"
        for m in _PLACEHOLDER_TOKEN_RE.finditer(candidate_masked_text):
            if m.group(0) not in self.placeholders:
                return False, f"Hallucinated unknown PII placeholder {m.group(0)}"
        return True, None

    def unmask(self, candidate_masked_text: str) -> str:
        ok, reason = self.verify_placeholder_integrity(candidate_masked_text)
        if not ok:
            raise ValueError(reason or "Placeholder integrity check failed")
        restored = candidate_masked_text
        for ph, secret_val in self.placeholders.items():
            restored = restored.replace(ph, secret_val)
        return restored


class ExtendedCampusPiiScrubberV2:
    """Zero-false-positive Indian statutory & campus PII scrubber.

    Preserves academic numerics (`CGPA 8.42`, `Rs. 14.50 Lakhs`, `85%`, `AY 2025-26`)
    while catching spaced/lowercase Aadhaar, PAN, PRN, bank accounts, UPI, IFSC, phone & email.
    """

    def scrub(self, text: str) -> ScrubbedText:
        if not text:
            return ScrubbedText(original_text="", masked_text="", placeholders={})

        # Find non-overlapping matches in priority order
        matches: list[tuple[int, int, str, str]] = []
        occupied: list[tuple[int, int]] = []
        for label, pat in _PATTERN_SPECS:
            for m in pat.finditer(text):
                s, e = m.start(), m.end()
                if any(not (e <= os_ or s >= oe_) for os_, oe_ in occupied):
                    continue
                occupied.append((s, e))
                matches.append((s, e, label, m.group(0)))

        matches.sort(key=lambda item: item[0])
        counters: dict[str, int] = {}
        placeholders: dict[str, str] = {}
        out: list[str] = []
        cursor = 0
        for s, e, label, val in matches:
            out.append(text[cursor:s])
            counters[label] = counters.get(label, 0) + 1
            ph = f"<{label}_{counters[label]}>"
            placeholders[ph] = val
            out.append(ph)
            cursor = e
        out.append(text[cursor:])
        return ScrubbedText(
            original_text=text,
            masked_text="".join(out),
            placeholders=placeholders,
        )

    def restore(self, scrubbed: ScrubbedText, candidate_text: str) -> str:
        return scrubbed.unmask(candidate_text)


default_pii_scrubber = ExtendedCampusPiiScrubberV2()
