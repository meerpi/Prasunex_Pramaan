"""Pramaan Finding, Evidence, Locator, and Suggestion schemas."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID, uuid5

from pydantic import Field

from pramaan.domain.canon import Rule
from pramaan.domain.types import FrozenModel

_FINDING_NS = UUID("6a9d5e21-8c3e-4b7f-a8c0-112233445566")


class Tier(StrEnum):
    TIER_1 = "tier_1_deterministic"
    TIER_1_5 = "tier_1_5_smt"
    TIER_2 = "tier_2_nli"
    TIER_3 = "tier_3_rewriter"


class Span(FrozenModel, frozen=True):
    """0-indexed Unicode codepoint interval `[start, end)` within a TextNode."""

    kind: Literal["span"] = "span"
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @property
    def key(self) -> str:
        return f"s:{self.start}-{self.end}"

    @property
    def sort_key(self) -> tuple[int, int, int]:
        return (0, self.start, self.end)


class BBox(FrozenModel, frozen=True):
    """Pixel or normalized page bounding box `(x0, y0, x1, y1)`."""

    kind: Literal["bbox"] = "bbox"
    x0: float
    y0: float
    x1: float
    y1: float
    page: int = 0

    @property
    def key(self) -> str:
        return f"b:{self.page}:{self.x0:.1f},{self.y0:.1f},{self.x1:.1f},{self.y1:.1f}"

    @property
    def sort_key(self) -> tuple[int, int, int]:
        return (1, int(self.page * 10000 + self.y0), int(self.x0))


Locator = Annotated[Span | BBox, Field(discriminator="kind")]


class TermMatch(FrozenModel, frozen=True):
    kind: Literal["term"] = "term"
    term: str
    preferred: str


class ConfusableEvidence(FrozenModel, frozen=True):
    kind: Literal["confusable"] = "confusable"
    spoofed_token: str
    skeleton_token: str
    confusable_chars: tuple[str, ...] = ()
    scripts: tuple[str, ...] = ()


class PaletteMismatch(FrozenModel, frozen=True):
    kind: Literal["palette"] = "palette"
    observed_hex: str
    nearest_token_hex: str
    delta_e: float
    max_delta_e: float


class ContrastEvidence(FrozenModel, frozen=True):
    kind: Literal["contrast"] = "contrast"
    fg_hex: str
    bg_hex: str
    contrast_ratio: float
    min_ratio: float


class HiddenTextEvidence(FrozenModel, frozen=True):
    kind: Literal["hidden_text"] = "hidden_text"
    reason: str
    page: int = 0
    snippet: str = ""
    wcag_contrast: float | None = None
    effective_font_pt: float | None = None


class MathContradictionEvidence(FrozenModel, frozen=True):
    kind: Literal["math_contradiction"] = "math_contradiction"
    claim_expression: str
    expected_value: str
    observed_value: str
    solver_id: str = "z3-push-pop-v4"
    witness: str = ""


class SlotEntry(FrozenModel, frozen=True):
    slot: str
    canon_value: str
    draft_value: str
    status: Literal["matched", "mismatched", "missing", "unverified"] = "mismatched"


class SlotDiffEvidence(FrozenModel, frozen=True):
    kind: Literal["slot_diff"] = "slot_diff"
    fact_id: str
    canon_text: str
    draft_sentence: str
    entailment_prob: float = 0.0
    contradiction_prob: float = 0.0
    slot_diffs: tuple[SlotEntry, ...] = ()


class TriggerObligationEvidence(FrozenModel, frozen=True):
    kind: Literal["trigger_obligation"] = "trigger_obligation"
    trigger_text: str
    required_disclaimer_id: str
    required_disclaimer_text: str
    issue: Literal["missing", "language_mismatch", "font_ratio_too_small"] = "missing"


class VoiceEvidence(FrozenModel, frozen=True):
    kind: Literal["voice"] = "voice"
    metric: str
    observed: float
    threshold: float


Evidence = Annotated[
    TermMatch
    | ConfusableEvidence
    | PaletteMismatch
    | ContrastEvidence
    | HiddenTextEvidence
    | MathContradictionEvidence
    | SlotDiffEvidence
    | TriggerObligationEvidence
    | VoiceEvidence,
    Field(discriminator="kind"),
]


class Replace(FrozenModel, frozen=True):
    kind: Literal["replace"] = "replace"
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    new_text: str


class RecolorRegion(FrozenModel, frozen=True):
    kind: Literal["recolor"] = "recolor"
    target_hex: str
    bbox: BBox | None = None


EditPatch = Annotated[Replace | RecolorRegion, Field(discriminator="kind")]


class Suggestion(FrozenModel, frozen=True):
    summary: str
    patch: EditPatch | None = None
    auto_applicable: bool = False


class Trace(FrozenModel, frozen=True):
    check_id: str
    check_version: str = "1.0"
    tier: Tier = Tier.TIER_1
    canon_id: str
    canon_hash: str
    latency_ms: float | None = None
    model_used: str | None = None
    notes: tuple[str, ...] = ()


class Finding(FrozenModel, frozen=True):
    """Canonical verification finding produced by a Pramaan Check."""

    id: UUID
    check_id: str
    node_id: str
    locator: Locator
    severity: Annotated[int, Field(ge=1, le=100)]
    message: str
    rule: Rule
    evidence: Evidence
    trace: Trace
    suggestion: Suggestion | None = None

    @staticmethod
    def deterministic_id(check_id: str, node_id: str, locator: Locator, rule_id: str) -> UUID:
        key = f"{check_id}|{node_id}|{locator.key}|{rule_id}"
        return uuid5(_FINDING_NS, key)

