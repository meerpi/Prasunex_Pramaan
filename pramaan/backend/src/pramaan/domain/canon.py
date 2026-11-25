"""Pramaan Canon schema: immutable compiled verification rules for campus & institutional governance."""

from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Annotated

from pydantic import Field, PrivateAttr, computed_field

from pramaan.domain.types import FrozenModel


@lru_cache(maxsize=512)
def _compile_word_pattern(pattern_text: str) -> re.Pattern[str]:
    escaped = re.escape(pattern_text.strip())
    if re.search(r"^\w", pattern_text.strip()) and re.search(r"\w$", pattern_text.strip()):
        return re.compile(rf"\b{escaped}\b", re.IGNORECASE)
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


@lru_cache(maxsize=512)
def _compile_trigger_pattern(pattern_text: str) -> re.Pattern[str]:
    try:
        return re.compile(pattern_text, re.IGNORECASE)
    except re.error:
        return re.compile(re.escape(pattern_text), re.IGNORECASE)


@lru_cache(maxsize=512)
def _parse_hex_rgb(hex_str: str) -> tuple[int, int, int]:
    cleaned = hex_str.strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(ch * 2 for ch in cleaned)
    if len(cleaned) != 6:
        raise ValueError(f"Invalid hex color: {hex_str!r}")
    return (int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16))


class Rule(FrozenModel, frozen=True):
    """Typed provenance reference pointing back to the triggering Canon rule."""

    rule_id: str
    rule_type: str
    source_text: str = ""
    char_start: int | None = None
    char_end: int | None = None


class TermRule(FrozenModel, frozen=True):
    """Terminology prohibition & preferred academic/regulatory phrasing."""

    id: str
    pattern_text: str
    preferred: str
    severity: Annotated[int, Field(ge=1, le=100)] = 65
    note: str = ""
    source_span_start: int | None = None
    source_span_end: int | None = None

    @property
    def pattern(self) -> re.Pattern[str]:
        return _compile_word_pattern(self.pattern_text)

    def __contains__(self, text: str) -> bool:
        return bool(self.pattern.search(text))

    def to_rule_ref(self) -> Rule:
        return Rule(
            rule_id=self.id,
            rule_type="term",
            source_text=self.note or self.pattern_text,
            char_start=self.source_span_start,
            char_end=self.source_span_end,
        )


class ColorToken(FrozenModel, frozen=True):
    """Approved visual palette swatch with CIEDE2000 tolerance."""

    id: str
    hex: str
    name: str = ""
    max_delta_e: float = 3.0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def rgb(self) -> tuple[int, int, int]:
        return _parse_hex_rgb(self.hex)

    def to_rule_ref(self) -> Rule:
        return Rule(rule_id=self.id, rule_type="color", source_text=f"{self.name} ({self.hex})")


class FactClaim(FrozenModel, frozen=True):
    """Grounded factual claim with restrictive conditions and ERP oracle expectation."""

    id: str
    text: str
    conditions: tuple[str, ...] = ()
    valid_until: str | None = None
    subject_product: str = ""
    metric_value: str = ""
    comparison_operator: str = "=="
    substantiation_level: str = "audited_sis_record"
    source_span_start: int | None = None
    source_span_end: int | None = None

    def to_rule_ref(self) -> Rule:
        return Rule(
            rule_id=self.id,
            rule_type="fact",
            source_text=self.text,
            char_start=self.source_span_start,
            char_end=self.source_span_end,
        )


class TriggerObligation(FrozenModel, frozen=True):
    """Conditional disclosure obligation (e.g., NAAC Cycle dates, placement cohort denominator)."""

    id: str
    trigger_pattern: str
    required_disclaimer_id: str
    required_disclaimer_text: str = ""
    same_language: bool = True
    same_font_family: bool = True
    min_font_height_ratio: float = 0.50
    severity: Annotated[int, Field(ge=1, le=100)] = 75

    @property
    def pattern(self) -> re.Pattern[str]:
        return _compile_trigger_pattern(self.trigger_pattern)

    def to_rule_ref(self) -> Rule:
        return Rule(
            rule_id=self.id,
            rule_type="trigger_obligation",
            source_text=self.required_disclaimer_text or self.trigger_pattern,
        )


class VoiceProfile(FrozenModel, frozen=True):
    """Academic & regulatory readability constraints."""

    id: str = "voice-default"
    max_sentence_words: int = 32
    min_sentence_words: int = 2
    max_passive_voice_pct: float = 28.0
    max_flesch_kincaid_grade: float = 14.0
    severity: Annotated[int, Field(ge=1, le=100)] = 40
    exemplars: tuple[str, ...] = ()

    def to_rule_ref(self) -> Rule:
        return Rule(rule_id=self.id, rule_type="voice_profile", source_text=self.id)


RuleObject = TermRule | ColorToken | FactClaim | TriggerObligation | VoiceProfile


class Canon(FrozenModel, frozen=True):
    """Compiled, signed verification playbook loaded by checks and the governance API."""

    id: str
    version: str = "2026.11"
    require_image_alt: bool = True
    min_wcag_contrast: float = 4.5
    terminology: tuple[TermRule, ...] = ()
    palette: tuple[ColorToken, ...] = ()
    facts: tuple[FactClaim, ...] = ()
    trigger_obligations: tuple[TriggerObligation, ...] = ()
    voice_profile: VoiceProfile | None = None
    applies_to: dict[str, str] = Field(default_factory=dict)
    enabled_checks: tuple[str, ...] = ()
    _cached_hash: str | None = PrivateAttr(default=None)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def hash(self) -> str:
        if self._cached_hash is None:
            payload = self.model_dump_json(exclude={"hash"}).encode("utf-8")
            self._cached_hash = hashlib.sha256(payload).hexdigest()
        return self._cached_hash

    def model_copy(self, *, update=None, deep: bool = False) -> Canon:
        copied = super().model_copy(update=update, deep=deep)
        copied._cached_hash = None
        return copied

    def to_rule_ref(self, rule: RuleObject) -> Rule:
        return rule.to_rule_ref()

    def iter_rules(self) -> list[RuleObject]:
        rules: list[RuleObject] = [
            *self.terminology,
            *self.palette,
            *self.facts,
            *self.trigger_obligations,
        ]
        if self.voice_profile is not None:
            rules.append(self.voice_profile)
        return rules


def compute_rule_friction(
    total_flags: int,
    disputed_or_overridden: int,
    *,
    prior_alpha: float = 1.0,
    prior_beta: float = 4.0,
) -> tuple[float, float]:
    """Return `(raw_friction, empirical_bayes_posterior)` using Beta(1, 4) shrinkage prior."""
    if total_flags <= 0:
        return 0.0, round(prior_alpha / (prior_alpha + prior_beta), 4)
    raw = disputed_or_overridden / float(total_flags)
    posterior = (disputed_or_overridden + prior_alpha) / (total_flags + prior_alpha + prior_beta)
    return round(raw, 4), round(posterior, 4)
