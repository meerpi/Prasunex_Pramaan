"""Tier 1 Security Check: Indirect Prompt Injection & Hidden Text Detection.

Respects import-linter boundary (does NOT import `pramaan.parsers`): inspects
AST hidden flags (`node.is_hidden`), `pdf/anomaly[...]` paths, HTML hidden markers,
and prompt-injection signatures (`ignore previous instructions`, `override system prompt`).
"""

from __future__ import annotations

import re
from typing import ClassVar

from pramaan.domain import (
    Canon,
    Finding,
    HiddenTextEvidence,
    Node,
    NodeKind,
    Replace,
    Rule,
    Span,
    Suggestion,
    TextNode,
    Tier,
)
from pramaan.engine.check import Check

_PROMPT_INJECTION_RE = re.compile(
    r"(?:\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b|"
    r"\boverride\s+(?:system\s+prompt|governance\s+policy|verdict)\b|"
    r"\bforce\s+verdict\s*[:=]\s*verified\b)",
    re.IGNORECASE,
)


class SecurityHiddenTextCheck(Check):
    check_id: ClassVar[str] = "security.hidden_text"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, TextNode) or not node.text:
            return []
        findings: list[Finding] = []
        rule = Rule(
            rule_id="sec-hidden-text-v2",
            rule_type="security",
            source_text="No hidden text layers, microtext, zero-contrast overlays, or prompt injections",
        )

        if (
            node.is_hidden
            or node.path.startswith("pdf/anomaly[")
            or node.path.startswith("html/hidden")
            or node.text.lstrip().startswith("[HIDDEN_ANOMALY]")
        ):
            findings.append(
                self.finding(
                    node=node,
                    locator=Span(start=0, end=len(node.text)),
                    message=f"Hidden or visually concealed text detected ({node.path}): {node.text[:80]!r}",
                    severity=95,
                    rule_ref=rule,
                    evidence=HiddenTextEvidence(
                        reason=node.path,
                        page=node.page or 0,
                        snippet=node.text[:160],
                        effective_font_pt=node.font_size_pt,
                    ),
                    suggestion=Suggestion(
                        summary="Remove concealed text layer from document before submission.",
                        patch=Replace(start=0, end=len(node.text), new_text=""),
                        auto_applicable=True,
                    ),
                    canon=canon,
                )
            )
            return findings

        for m in _PROMPT_INJECTION_RE.finditer(node.text):
            findings.append(
                self.finding(
                    node=node,
                    locator=Span(start=m.start(), end=m.end()),
                    message=f"Adversarial prompt-injection instruction detected: {m.group(0)!r}",
                    severity=95,
                    rule_ref=rule,
                    evidence=HiddenTextEvidence(
                        reason="prompt_injection_pattern",
                        page=node.page or 0,
                        snippet=m.group(0),
                    ),
                    suggestion=Suggestion(
                        summary="Strip adversarial instruction override text.",
                        patch=Replace(start=m.start(), end=m.end(), new_text=""),
                        auto_applicable=True,
                    ),
                    canon=canon,
                )
            )
        return findings

