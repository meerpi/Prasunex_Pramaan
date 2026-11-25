"""Immutable hashing and shared helper types for Pramaan domain models."""

from __future__ import annotations

import hashlib

from pydantic import BaseModel


class FrozenModel(BaseModel, frozen=True):
    """Base value object shared by AST, Canon, and Finding schemas."""


def content_hash(raw: bytes) -> str:
    """Return canonical lowercase SHA-256 hex digest of raw bytes."""
    return hashlib.sha256(raw).hexdigest()


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG 2.1 sRGB relative luminance."""
    vals: list[float] = []
    for c in rgb:
        s = max(0.0, min(1.0, c / 255.0))
        vals.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]


def wcag_contrast_ratio(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    """WCAG 2.1 contrast ratio between two 8-bit RGB colors."""
    l1 = relative_luminance(rgb1)
    l2 = relative_luminance(rgb2)
    hi, lo = (l1, l2) if l1 >= l2 else (l2, l1)
    return (hi + 0.05) / (lo + 0.05)

