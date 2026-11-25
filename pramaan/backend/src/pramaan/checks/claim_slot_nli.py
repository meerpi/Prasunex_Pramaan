"""Tier 2 Check: Hybrid Retrieval + Indian Unit Pre-Normalized DeBERTa-v3 NLI + Slot Alignment (`claim.slot_nli`)."""

from __future__ import annotations

import re
from typing import ClassVar

from pramaan.domain import (
    Canon,
    Finding,
    Node,
    NodeKind,
    SlotDiffEvidence,
    SlotEntry,
    Span,
    Suggestion,
    TextNode,
    Tier,
)
from pramaan.engine.check import Check
from pramaan.engine.nli import score_nli_pairs
from pramaan.engine.retriever import default_retriever

_SENT_SPLIT_RE = re.compile(r"(?<!\bRs\.)(?<!\bDr\.)(?<!\bMr\.)(?<!\bMs\.)(?<!\bProf\.)(?<=[.!?])\s+|\n+")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?%?")


class ClaimSlotNliCheck(Check):
    check_id: ClassVar[str] = "claim.slot_nli"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_2
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, TextNode) or node.is_hidden or not canon.facts:
            return []

        findings: list[Finding] = []
        cursor = 0
        candidates: list[tuple[int, int, str, object]] = []
        for raw_sent in _SENT_SPLIT_RE.split(node.text):
            sent = raw_sent.strip()
            if len(sent.split()) < 5:
                cursor += len(raw_sent) + 1
                continue
            start_idx = node.text.find(sent, max(0, cursor - 2))
            if start_idx < 0:
                start_idx = 0
            end_idx = start_idx + len(sent)
            cursor = end_idx

            retrieved = default_retriever.retrieve(sent, canon.facts, top_k=2)
            if not retrieved:
                continue

            # Only compare sentence against retrieved facts sharing subject/metric vocabulary
            top = retrieved[0].fact
            subj_tokens = [w for w in (top.subject_product + " " + top.text).lower().split() if len(w) >= 5]
            overlap = sum(1 for w in subj_tokens if w in sent.lower())
            if overlap < 2:
                continue
            candidates.append((start_idx, end_idx, sent, top))

        if not candidates:
            return []

        predictions = score_nli_pairs([(top.text, sent) for _, _, sent, top in candidates])
        for (start_idx, end_idx, sent, top), nli in zip(candidates, predictions, strict=True):
            slot_diffs: list[SlotEntry] = []
            for cond in top.conditions:
                cond_kw = [w for w in cond.lower().split() if len(w) >= 4]
                if cond_kw and sum(1 for w in cond_kw if w in sent.lower()) < max(1, len(cond_kw) // 2):
                    slot_diffs.append(
                        SlotEntry(
                            slot="condition",
                            canon_value=cond,
                            draft_value="(omitted qualifier)",
                            status="missing",
                        )
                    )

            is_flagged = nli.label == "contradiction" or bool(slot_diffs and _NUM_RE.search(sent))
            if not is_flagged:
                continue

            sev = 80 if nli.label == "contradiction" else 48
            findings.append(
                self.finding(
                    node=node,
                    locator=Span(start=start_idx, end=end_idx),
                    message=(
                        f"Tier 2 NLI/Slot mismatch vs Canon `{top.id}`: "
                        + ("; ".join(f"missing {sd.canon_value!r}" for sd in slot_diffs) if slot_diffs else f"p_contra={nli.p_contradiction:.2f}")
                    ),
                    severity=sev,
                    rule_ref=canon.to_rule_ref(top),
                    evidence=SlotDiffEvidence(
                        fact_id=top.id,
                        canon_text=top.text,
                        draft_sentence=sent,
                        entailment_prob=nli.p_entailment,
                        contradiction_prob=nli.p_contradiction,
                        slot_diffs=tuple(slot_diffs),
                    ),
                    suggestion=Suggestion(summary=f"Align claim and qualifiers with Canon `{top.id}`: {top.text}"),
                    canon=canon,
                    model_used=nli.model_used,
                )
            )
        return findings

