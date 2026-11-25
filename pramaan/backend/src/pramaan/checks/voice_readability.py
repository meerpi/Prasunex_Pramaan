"""Tier 1 Check: Academic Voice, Readability, Passive Voice %, and Max Sentence Length."""

from __future__ import annotations

import re
from typing import ClassVar

from pramaan.domain import (
    Canon,
    Finding,
    Node,
    NodeKind,
    Span,
    TextNode,
    Tier,
    VoiceEvidence,
)
from pramaan.engine.check import Check

_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_PASSIVE_RE = re.compile(r"\b(?:is|are|was|were|been|being|be)\s+\w+(?:ed|en)\b", re.IGNORECASE)
_VOWEL_GROUP_RE = re.compile(r"[aeiouy]+", re.IGNORECASE)


def _count_syllables(word: str) -> int:
    clean = re.sub(r"[^a-z]", "", word.lower())
    if not clean:
        return 0
    if len(clean) <= 3:
        return 1
    clean = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", clean)
    clean = re.sub(r"^y", "", clean)
    return max(1, len(_VOWEL_GROUP_RE.findall(clean)))


def _flesch_kincaid_grade(text: str) -> float:
    words = re.findall(r"[A-Za-z0-9']+", text)
    sents = [s for s in _SENT_SPLIT_RE.split(text.strip()) if s.strip()]
    w_count = max(1, len(words))
    s_count = max(1, len(sents))
    syl_count = max(w_count, sum(_count_syllables(w) for w in words))
    return 0.39 * (w_count / s_count) + 11.8 * (syl_count / w_count) - 15.59


class VoiceReadabilityCheck(Check):
    check_id: ClassVar[str] = "voice.readability"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        vp = canon.voice_profile
        if vp is None or not isinstance(node, TextNode) or node.is_hidden or len(node.text.split()) < 6:
            return []

        findings: list[Finding] = []
        sentences = [s.strip() for s in _SENT_SPLIT_RE.split(node.text) if s.strip()]
        long_sents = [s for s in sentences if len(s.split()) > vp.max_sentence_words]
        if long_sents:
            longest = max(long_sents, key=lambda s: len(s.split()))
            idx = node.text.find(longest)
            span = Span(start=max(0, idx), end=max(0, idx) + len(longest) if idx >= 0 else len(node.text))
            findings.append(
                self.finding(
                    node=node,
                    locator=span,
                    message=f"Sentence has {len(longest.split())} words (ceiling {vp.max_sentence_words} words).",
                    severity=vp.severity,
                    rule_ref=canon.to_rule_ref(vp),
                    evidence=VoiceEvidence(
                        metric="max_sentence_words",
                        observed=float(len(longest.split())),
                        threshold=float(vp.max_sentence_words),
                    ),
                    canon=canon,
                )
            )

        if sentences:
            passive_cnt = sum(1 for s in sentences if _PASSIVE_RE.search(s))
            passive_pct = (passive_cnt / len(sentences)) * 100.0
            if passive_pct > vp.max_passive_voice_pct and len(sentences) >= 2:
                findings.append(
                    self.finding(
                        node=node,
                        locator=Span(start=0, end=len(node.text)),
                        message=f"Passive voice ratio {passive_pct:.1f}% exceeds {vp.max_passive_voice_pct:.1f}%.",
                        severity=vp.severity,
                        rule_ref=canon.to_rule_ref(vp),
                        evidence=VoiceEvidence(
                            metric="passive_voice_pct",
                            observed=round(passive_pct, 1),
                            threshold=vp.max_passive_voice_pct,
                        ),
                        canon=canon,
                    )
                )

        if len(node.text.split()) >= 15:
            fk = float(_flesch_kincaid_grade(node.text))
            if fk > vp.max_flesch_kincaid_grade:
                findings.append(
                    self.finding(
                        node=node,
                        locator=Span(start=0, end=len(node.text)),
                        message=f"Flesch-Kincaid grade {fk:.1f} exceeds {vp.max_flesch_kincaid_grade:.1f}.",
                        severity=vp.severity,
                        rule_ref=canon.to_rule_ref(vp),
                        evidence=VoiceEvidence(
                            metric="flesch_kincaid_grade",
                            observed=round(fk, 2),
                            threshold=vp.max_flesch_kincaid_grade,
                        ),
                        canon=canon,
                    )
                )
        return findings

