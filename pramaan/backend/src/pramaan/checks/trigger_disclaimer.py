"""Tier 1 Check: Conditional Disclosure Obligations (Placement Pool / NAAC Cycle / Condonation)."""

from __future__ import annotations

from typing import ClassVar

from pramaan.domain import (
    Canon,
    Finding,
    Node,
    NodeKind,
    Replace,
    Span,
    Suggestion,
    TextNode,
    Tier,
    TriggerObligationEvidence,
)
from pramaan.engine.check import Check


class TriggerDisclaimerCheck(Check):
    check_id: ClassVar[str] = "trigger.disclaimer"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run_bundle(self, ast_nodes: tuple[Node, ...], canon: Canon) -> list[Finding]:
        if not canon.trigger_obligations:
            return []
        text_nodes = [n for n in ast_nodes if isinstance(n, TextNode) and not n.is_hidden]
        full_doc_lower = " ".join(n.text for n in text_nodes).lower()
        findings: list[Finding] = []

        for node in text_nodes:
            for trig in canon.trigger_obligations:
                m = trig.pattern.search(node.text)
                if not m:
                    continue
                req = (trig.required_disclaimer_text or "").strip()
                if not req:
                    continue
                # Check key tokens of disclaimer appear across document
                req_words = [w for w in req.lower().split() if len(w) >= 5]
                matched_kw = sum(1 for w in req_words if w in full_doc_lower)
                coverage = matched_kw / max(1, len(req_words))
                if coverage >= 0.55:
                    continue

                span = Span(start=m.start(), end=m.end())
                patched_end = f"{node.text.rstrip()} ({req})."
                findings.append(
                    self.finding(
                        node=node,
                        locator=span,
                        message=(
                            f"Claim {m.group(0)!r} triggers mandatory qualifier/disclosure: {req!r}"
                        ),
                        severity=trig.severity,
                        rule_ref=canon.to_rule_ref(trig),
                        evidence=TriggerObligationEvidence(
                            trigger_text=m.group(0),
                            required_disclaimer_id=trig.required_disclaimer_id,
                            required_disclaimer_text=req,
                            issue="missing",
                        ),
                        suggestion=Suggestion(
                            summary=f"Append required qualifier: ({req})",
                            patch=Replace(start=0, end=len(node.text), new_text=patched_end),
                            auto_applicable=True,
                        ),
                        canon=canon,
                    )
                )
        return findings

