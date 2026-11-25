"""Workflow FSM, 5-Role Institutional RBAC, and transition guards."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    STUDENT = "student"
    PARENT = "parent"
    TEACHER = "teacher"
    RECRUITER = "recruiter"
    ADMIN = "admin"


class Status(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    CHANGES_REQUESTED = "changes_requested"
    APPROVED = "approved"
    PUBLISHED = "published"


class Action(StrEnum):
    SUBMIT = "submit"
    REQUEST_CHANGES = "request_changes"
    APPROVE = "approve"
    PUBLISH = "publish"
    RECALL = "recall"


_ALLOWED_TRANSITIONS: dict[tuple[Status, Action], tuple[Status, frozenset[Role]]] = {
    (Status.DRAFT, Action.SUBMIT): (Status.IN_REVIEW, frozenset({Role.STUDENT, Role.TEACHER, Role.ADMIN})),
    (Status.CHANGES_REQUESTED, Action.SUBMIT): (Status.IN_REVIEW, frozenset({Role.STUDENT, Role.TEACHER, Role.ADMIN})),
    (Status.IN_REVIEW, Action.REQUEST_CHANGES): (Status.CHANGES_REQUESTED, frozenset({Role.TEACHER, Role.ADMIN})),
    (Status.IN_REVIEW, Action.APPROVE): (Status.APPROVED, frozenset({Role.TEACHER, Role.ADMIN})),
    (Status.APPROVED, Action.PUBLISH): (Status.PUBLISHED, frozenset({Role.TEACHER, Role.ADMIN})),
    (Status.IN_REVIEW, Action.RECALL): (Status.DRAFT, frozenset({Role.STUDENT, Role.TEACHER, Role.ADMIN})),
    (Status.CHANGES_REQUESTED, Action.RECALL): (Status.DRAFT, frozenset({Role.STUDENT, Role.TEACHER, Role.ADMIN})),
}


def transition_submission(
    current: Status,
    action: Action,
    role: Role,
    *,
    has_unresolved_blockers: bool = False,
) -> Status:
    """Validate role & workflow invariants before mutating submission state."""
    key = (current, action)
    if key not in _ALLOWED_TRANSITIONS:
        raise ValueError(f"Action {action.value!r} is not valid from state {current.value!r}")
    next_state, allowed_roles = _ALLOWED_TRANSITIONS[key]
    if role not in allowed_roles:
        raise PermissionError(
            f"Role {role.value!r} is not permitted to perform {action.value!r}"
        )
    if action in (Action.APPROVE, Action.PUBLISH) and has_unresolved_blockers:
        raise ValueError("Cannot approve or publish while unresolved Blocker (severity >= 50) findings remain")
    return next_state

