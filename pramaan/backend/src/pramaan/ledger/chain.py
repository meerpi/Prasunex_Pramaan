"""Tamper-evident SHA-256 hash chain for governance workflow audit events."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

GENESIS_HASH = "0" * 64


@dataclass(frozen=True, slots=True)
class AuditChainEvent:
    submission_id: int
    action: str
    actor_id: int
    timestamp: str
    prev_hash: str
    event_hash: str


def compute_event_hash(
    prev_hash: str,
    submission_id: int,
    action: str,
    actor_id: int,
    timestamp: str,
) -> str:
    payload = f"{prev_hash}|{submission_id}|{action}|{actor_id}|{timestamp}".encode()
    return hashlib.sha256(payload).hexdigest()


def verify_chain(events: list[AuditChainEvent]) -> tuple[bool, int | None]:
    prev = GENESIS_HASH
    for idx, ev in enumerate(events):
        if ev.prev_hash != prev:
            return False, idx
        expected = compute_event_hash(ev.prev_hash, ev.submission_id, ev.action, ev.actor_id, ev.timestamp)
        if ev.event_hash != expected:
            return False, idx
        prev = ev.event_hash
    return True, None
