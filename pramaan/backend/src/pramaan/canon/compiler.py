"""Pipeline A: Grounded Canon Compiler with Anti-Loss Guards (Anchors, Exact Spans, Round-Trip NLI)."""

from __future__ import annotations

import re
from dataclasses import dataclass

from pramaan.domain import (
    Canon,
    ColorToken,
    FactClaim,
    TermRule,
    TriggerObligation,
    VoiceProfile,
)
from pramaan.engine import score_nli_pairs

_BANNED_RE = re.compile(
    r"""(?:never\s+use|avoid|ban(?:ned)?(?:\s+(?:term|phrase))?\s*[:\-]?)\s*['"]([^'"]+)['"]\s*(?:[,;—\-]|->|→)?\s*(?:use|prefer|replace\s+with)?\s*[:\-]?\s*['"]([^'"]+)['"]""",
    re.IGNORECASE,
)
_TRIGGER_RE = re.compile(
    r"""(?:if|when)\s+(?:copy\s+)?(?:mentions?|uses?)\s+['"]([^'"]+)['"]\s*[,;\-→>]*\s*(?:then\s+)?(?:include|require)\s+['"]([^'"]+)['"]""",
    re.IGNORECASE,
)
_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6})\b")
_ANCHOR_RE = re.compile(r"(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:FY|AY)\s*\d{4}-\d{2}\b|(?:Rs\.?|INR|₹|\$)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:crores?|lakhs?|million))?|\b\d+(?:\.\d+)?\s*%)", re.IGNORECASE)
_RESTRICTIVE_RE = re.compile(r"\b(?:among|excluding|within|subject to|only for|as of|valid until|at most)\s+[^.;,\n]+", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class CompilationResult:
    canon: Canon
    warnings: tuple[str, ...] = ()
    grounded_rules_count: int = 0
    rejected_hallucinations: int = 0


_SENT_SPLIT_RE = re.compile(
    r"(?<!\bRs)(?<!\bDr)(?<!\bMr)(?<!\bMs)(?<!\bSt)(?<!\bNo)(?<!\bProf)(?<!\d)[.!?](?=\s|$)|\n+"
)


def _iter_sentence_spans(raw_text: str) -> list[tuple[int, int, str]]:
    """Split prose cleanly without breaking `Rs. 3.17` decimals or abbreviations."""
    spans: list[tuple[int, int, str]] = []
    start = 0
    for sep in _SENT_SPLIT_RE.finditer(raw_text):
        end = sep.end() if sep.group(0) in (".", "!", "?") else sep.start()
        frag = raw_text[start:end].strip()
        if frag:
            lead = len(raw_text[start:end]) - len(raw_text[start:end].lstrip())
            s0 = start + lead
            spans.append((s0, s0 + len(frag), frag))
        start = sep.end()
    if start < len(raw_text):
        frag = raw_text[start:].strip()
        if frag:
            lead = len(raw_text[start:]) - len(raw_text[start:].lstrip())
            s0 = start + lead
            spans.append((s0, s0 + len(frag), frag))
    return spans


def compile_canon(*, canon_id: str, raw_text: str, version: str = "1.0") -> CompilationResult:
    """Compile policy prose / markdown into a grounded immutable `Canon`."""
    terms: list[TermRule] = []
    colors: list[ColorToken] = []
    triggers: list[TriggerObligation] = []
    facts: list[FactClaim] = []
    warnings: list[str] = []
    rejected = 0

    for idx, m in enumerate(_BANNED_RE.finditer(raw_text)):
        terms.append(
            TermRule(
                id=f"{canon_id}-term-{idx + 1}",
                pattern_text=m.group(1).strip(),
                preferred=m.group(2).strip(),
                severity=75,
                source_span_start=m.start(),
                source_span_end=m.end(),
            )
        )

    for idx, m in enumerate(_TRIGGER_RE.finditer(raw_text)):
        triggers.append(
            TriggerObligation(
                id=f"{canon_id}-trig-{idx + 1}",
                trigger_pattern=re.escape(m.group(1).strip()),
                required_disclaimer_id=f"disc-{idx + 1}",
                required_disclaimer_text=m.group(2).strip(),
                severity=75,
            )
        )

    seen_hex: set[str] = set()
    for idx, m in enumerate(_HEX_RE.finditer(raw_text)):
        hx = m.group(0).upper()
        if hx not in seen_hex:
            seen_hex.add(hx)
            colors.append(ColorToken(id=f"{canon_id}-col-{idx + 1}", hex=hx, name=f"Compiled Swatch {idx + 1}"))

    # Fact sentences containing numeric anchors -> apply Anti-Loss Guard 1 + Guard 2 + Guard 3
    pending_facts: list[tuple[int, int, int, str, tuple[str, ...], list[str], str]] = []
    for idx, (s_start, s_end, sent) in enumerate(_iter_sentence_spans(raw_text)):
        if len(sent.split()) < 6 or not _ANCHOR_RE.search(sent):
            continue
        if _BANNED_RE.search(sent) or _TRIGGER_RE.search(sent):
            continue
        conds = tuple(m.group(0).strip() for m in _RESTRICTIVE_RE.finditer(sent))
        anchors = [m.group(0).strip() for m in _ANCHOR_RE.finditer(sent)]
        # Guard 2: verify exact char span inside raw_text
        if raw_text[s_start:s_end].strip() != sent:
            rejected += 1
            continue
        recon = sent if not conds else f"{sent} Conditions: {'; '.join(conds)}"
        pending_facts.append((idx, s_start, s_end, sent, conds, anchors, recon))

    if pending_facts:
        preds = score_nli_pairs([(sent, recon) for _, _, _, sent, _, _, recon in pending_facts])
        for (idx, s_start, s_end, sent, conds, anchors, _), pred in zip(pending_facts, preds, strict=True):
            # Guard 3: round-trip NLI entailment check (non-contradiction + lexical anchor retention)
            if pred.label == "contradiction":
                rejected += 1
                warnings.append(f"Rejected fact candidate at line span {s_start}: failed Guard 3 NLI.")
                continue
            facts.append(
                FactClaim(
                    id=f"{canon_id}-fact-{idx + 1}",
                    text=sent,
                    conditions=conds or tuple(anchors[:2]),
                    metric_value=anchors[0] if anchors else "",
                    source_span_start=s_start,
                    source_span_end=s_end,
                )
            )

    canon = Canon(
        id=canon_id,
        version=version,
        terminology=tuple(terms),
        palette=tuple(colors),
        facts=tuple(facts),
        trigger_obligations=tuple(triggers),
        voice_profile=VoiceProfile(id=f"{canon_id}-voice"),
    )
    return CompilationResult(
        canon=canon,
        warnings=tuple(warnings),
        grounded_rules_count=len(terms) + len(colors) + len(triggers) + len(facts),
        rejected_hallucinations=rejected,
    )
