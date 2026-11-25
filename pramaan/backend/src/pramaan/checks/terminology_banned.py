"""Tier 1 Check: Canon Terminology Prohibitions & Preferred Academic/Regulatory Replacements."""

from __future__ import annotations

from typing import ClassVar

from pramaan.checks.unicode_confusable import _UTS39_SKELETON_MAP, _ZERO_WIDTH_CHARS
from pramaan.domain import (
    Canon,
    Finding,
    Node,
    NodeKind,
    Replace,
    Span,
    Suggestion,
    TermMatch,
    TextNode,
    Tier,
)
from pramaan.engine.check import Check


def _fold_confusables(text: str) -> tuple[str, list[int]]:
    """Strip stealth zero-width chars & map Cyrillic/Greek homoglyphs while keeping char->orig index map."""
    folded: list[str] = []
    idx_map: list[int] = []
    for i, ch in enumerate(text):
        if ch in _ZERO_WIDTH_CHARS:
            continue
        folded.append(_UTS39_SKELETON_MAP.get(ch, ch))
        idx_map.append(i)
    return "".join(folded), idx_map


class TerminologyBannedCheck(Check):
    check_id: ClassVar[str] = "terminology.banned"
    check_version: ClassVar[str] = "2.1"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, TextNode) or not node.text or node.is_hidden:
            return []
        folded, idx_map = _fold_confusables(node.text)
        findings: list[Finding] = []
        for rule in canon.terminology:
            for m in rule.pattern.finditer(folded):
                orig_s = idx_map[m.start()] if m.start() < len(idx_map) else m.start()
                orig_e = (idx_map[m.end() - 1] + 1) if m.end() > 0 and m.end() - 1 < len(idx_map) else len(node.text)
                matched = node.text[orig_s:orig_e]
                span = Span(start=orig_s, end=orig_e)
                findings.append(
                    self.finding(
                        node=node,
                        locator=span,
                        message=f'Prohibited phrasing "{matched}". Use "{rule.preferred}". {rule.note}'.strip(),
                        severity=rule.severity,
                        rule_ref=canon.to_rule_ref(rule),
                        evidence=TermMatch(term=matched, preferred=rule.preferred),
                        suggestion=Suggestion(
                            summary=f'Replace "{matched}" with "{rule.preferred}"',
                            patch=Replace(start=orig_s, end=orig_e, new_text=rule.preferred),
                            auto_applicable=True,
                        ),
                        canon=canon,
                    )
                )
        return findings

