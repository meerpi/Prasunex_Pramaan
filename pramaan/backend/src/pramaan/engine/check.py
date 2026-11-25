"""Pramaan abstract Check base class & auto-registry (`pramaan.engine.check`)."""

from __future__ import annotations

import logging
from typing import ClassVar

from pramaan.domain import (
    Canon,
    Evidence,
    Finding,
    Locator,
    Node,
    NodeKind,
    Rule,
    Suggestion,
    Tier,
    Trace,
)

logger = logging.getLogger(__name__)


class Check:
    """Base contract for all deterministic, SMT, and neural checks."""

    check_id: ClassVar[str] = "base.check"
    check_version: ClassVar[str] = "1.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    _registry: ClassVar[dict[str, type[Check]]] = {}

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        cid = getattr(cls, "check_id", "")
        if cid and cid != "base.check":
            Check._registry[cid] = cls

    @classmethod
    def get_all(cls) -> dict[str, type[Check]]:
        return dict(cls._registry)

    def __eq__(self, other: object) -> bool:
        return type(self) is type(other) and self.check_id == getattr(other, "check_id", None)

    def __hash__(self) -> int:
        return hash((type(self), self.check_id))

    def __call__(self, node: Node, canon: Canon) -> list[Finding]:
        return self.run(node, canon)

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        return []

    def run_bundle(self, ast_nodes: tuple[Node, ...], canon: Canon) -> list[Finding]:
        return []

    def finding(
        self,
        *,
        node: Node,
        locator: Locator,
        message: str,
        severity: int,
        rule_ref: Rule,
        evidence: Evidence,
        suggestion: Suggestion | None = None,
        canon: Canon,
        model_used: str | None = None,
        notes: tuple[str, ...] = (),
    ) -> Finding:
        return Finding(
            id=Finding.deterministic_id(self.check_id, node.id, locator, rule_ref.rule_id),
            check_id=self.check_id,
            node_id=node.id,
            locator=locator,
            severity=severity,
            message=message,
            rule=rule_ref,
            evidence=evidence,
            trace=Trace(
                check_id=self.check_id,
                check_version=self.check_version,
                tier=self.tier,
                canon_id=canon.id,
                canon_hash=canon.hash,
                model_used=model_used,
                notes=notes,
            ),
            suggestion=suggestion,
        )

