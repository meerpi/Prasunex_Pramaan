"""Canon Linter, Empirical Bayes Friction -> v1.1 PR Generator, Calibrator, and Impact Simulator."""

from __future__ import annotations

import difflib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

import yaml

from pramaan.checks._vision import delta_e_ciede2000, rgb_to_lab
from pramaan.domain import Canon, ContentAST, Finding, TermRule, compute_rule_friction


@dataclass(frozen=True, slots=True)
class CanonLintIssue:
    rule_ids: tuple[str, ...]
    kind: str  # "duplicate_id" | "circular_term" | "overlapping_color"
    message: str


@dataclass(frozen=True, slots=True)
class RuleRevisionDiff:
    rule_id: str
    posterior_friction: float
    action: str
    before_summary: str
    after_summary: str
    rationale: str


@dataclass(frozen=True, slots=True)
class CanonRevisionProposal:
    base_canon: Canon
    revised_canon: Canon
    revisions: tuple[RuleRevisionDiff, ...]
    yaml_diff: str

    def __bool__(self) -> bool:
        return bool(self.revisions)


@dataclass(frozen=True, slots=True)
class ImpactSimulationResult:
    bundles_evaluated: int
    before_findings: int
    after_findings: int
    before_blockers: int
    after_blockers: int
    resolved_rule_ids: tuple[str, ...]


def canon_to_yaml(canon: Canon) -> str:
    payload = canon.model_dump(mode="json", exclude={"hash"})
    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)


def lint_canon(canon: Canon) -> list[CanonLintIssue]:
    issues: list[CanonLintIssue] = []
    seen: set[str] = set()
    for rule in canon.iter_rules():
        rid = getattr(rule, "id", "")
        if rid in seen:
            issues.append(CanonLintIssue((rid,), "duplicate_id", f"Duplicate rule id {rid!r}"))
        seen.add(rid)

    banned_low = {t.pattern_text.strip().lower(): t for t in canon.terminology}
    for t in canon.terminology:
        pref = t.preferred.strip().lower()
        if t.pattern_text.strip().lower() == pref:
            issues.append(CanonLintIssue((t.id,), "circular_term", f"TermRule {t.id!r} replaces text with itself."))
        elif pref in banned_low and banned_low[pref].id != t.id:
            other = banned_low[pref]
            issues.append(
                CanonLintIssue(
                    (t.id, other.id),
                    "circular_term",
                    f"TermRule {t.id!r} prefers {t.preferred!r}, which is prohibited by {other.id!r}.",
                )
            )

    for i in range(len(canon.palette)):
        for j in range(i + 1, len(canon.palette)):
            c1, c2 = canon.palette[i], canon.palette[j]
            de = delta_e_ciede2000(rgb_to_lab(c1.rgb), rgb_to_lab(c2.rgb))
            if de < max(c1.max_delta_e, c2.max_delta_e):
                issues.append(
                    CanonLintIssue(
                        (c1.id, c2.id),
                        "overlapping_color",
                        f"Swatches {c1.hex} and {c2.hex} are within tolerance (ΔE00={de:.2f}).",
                    )
                )
    return issues


def _bump_minor(version: str) -> str:
    parts = version.split(".")
    if len(parts) >= 2 and parts[-1].isdigit():
        return ".".join(parts[:-1] + [str(int(parts[-1]) + 1)])
    return f"{version}.1"


def propose_canon_revision(
    canon: Canon,
    friction_counts: Mapping[str, tuple[int, int]],
    *,
    threshold: float = 0.40,
    min_flags: int = 3,
) -> CanonRevisionProposal:
    new_terms: list[TermRule] = []
    revisions: list[RuleRevisionDiff] = []

    for t in canon.terminology:
        tot, disp = friction_counts.get(t.id, (0, 0))
        _, post = compute_rule_friction(tot, disp)
        if tot >= min_flags and post >= threshold and t.severity >= 50:
            bumped = t.model_copy(update={"severity": 35})
            new_terms.append(bumped)
            revisions.append(
                RuleRevisionDiff(
                    rule_id=t.id,
                    posterior_friction=post,
                    action="downgrade_to_advisory",
                    before_summary=f"severity={t.severity}",
                    after_summary="severity=35",
                    rationale=f"High override rate ({disp}/{tot}, EB posterior {post:.2f}) indicates legitimate edge exemptions.",
                )
            )
        else:
            new_terms.append(t)

    revised = canon.model_copy(
        update={
            "version": _bump_minor(canon.version) if revisions else canon.version,
            "terminology": tuple(new_terms),
        }
    )
    diff = "".join(
        difflib.unified_diff(
            canon_to_yaml(canon).splitlines(keepends=True),
            canon_to_yaml(revised).splitlines(keepends=True),
            fromfile=f"{canon.id}@v{canon.version}.yaml",
            tofile=f"{revised.id}@v{revised.version}.yaml",
        )
    )
    return CanonRevisionProposal(
        base_canon=canon,
        revised_canon=revised,
        revisions=tuple(revisions),
        yaml_diff=diff,
    )


def simulate_canon_impact(
    old_canon: Canon,
    new_canon: Canon,
    bundles: Sequence[ContentAST],
    check_fn: Callable[[ContentAST, Canon], Sequence[Finding]],
) -> ImpactSimulationResult:
    b_total = a_total = b_block = a_block = 0
    old_rules: set[str] = set()
    new_rules: set[str] = set()
    for ast in bundles:
        bf = check_fn(ast, old_canon)
        af = check_fn(ast, new_canon)
        b_total += len(bf)
        a_total += len(af)
        b_block += sum(1 for f in bf if f.severity >= 50)
        a_block += sum(1 for f in af if f.severity >= 50)
        old_rules.update(f.rule.rule_id for f in bf)
        new_rules.update(f.rule.rule_id for f in af)
    return ImpactSimulationResult(
        bundles_evaluated=len(bundles),
        before_findings=b_total,
        after_findings=a_total,
        before_blockers=b_block,
        after_blockers=a_block,
        resolved_rule_ids=tuple(sorted(old_rules - new_rules)),
    )
