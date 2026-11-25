"""Tier 1 Check: Unicode UTS #39 Mixed-Script Homoglyph Spoofing & Script-Aware ZWJ Guard."""

from __future__ import annotations

import re
import unicodedata
from typing import ClassVar

from pramaan.domain import (
    Canon,
    ConfusableEvidence,
    Finding,
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

_ZERO_WIDTH_CHARS = frozenset({"\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u00ad"})

_UTS39_SKELETON_MAP: dict[str, str] = {
    "\u0430": "a",
    "\u0410": "A",
    "\u0435": "e",
    "\u0415": "E",
    "\u0456": "i",
    "\u0406": "I",
    "\u043e": "o",
    "\u041e": "O",
    "\u0440": "p",
    "\u0420": "P",
    "\u0441": "c",
    "\u0421": "C",
    "\u0442": "t",
    "\u0422": "T",
    "\u0443": "y",
    "\u0423": "Y",
    "\u0445": "x",
    "\u0425": "X",
    "\u0455": "s",
    "\u0405": "S",
    "\u03b1": "a",
    "\u03bf": "o",
    "\u03c1": "p",
    "\u03b5": "e",
    "\u03ba": "k",
    "\u03bd": "v",
}

_TOKEN_RE = re.compile(r"\S+")


def _char_script(ch: str) -> str | None:
    if not ch.isalpha():
        return None
    name = unicodedata.name(ch, "")
    if not name:
        return None
    first = name.split()[0]
    if first in ("LATIN", "CYRILLIC", "GREEK", "DEVANAGARI", "ARABIC", "HEBREW"):
        return first
    return None


def _is_legitimate_script_joiner(token: str, idx: int) -> bool:
    """Allow Devanagari virama/conjunct ZWJ (`U+094D + U+200D/C`) & emoji sequences (S1-v2 fix)."""
    ch = token[idx]
    if ch not in ("\u200c", "\u200d"):
        return False
    prev_ch = token[idx - 1] if idx > 0 else ""
    next_ch = token[idx + 1] if idx + 1 < len(token) else ""
    if "\u0900" <= prev_ch <= "\u097f" or "\u0900" <= next_ch <= "\u097f":
        return True
    return bool(prev_ch and ord(prev_ch) >= 0x1F300 and next_ch and ord(next_ch) >= 0x1F300)


class UnicodeConfusableCheck(Check):
    check_id: ClassVar[str] = "unicode.confusable"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.TEXT})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, TextNode) or not node.text:
            return []
        findings: list[Finding] = []

        for m in _TOKEN_RE.finditer(node.text):
            tok = m.group(0)
            scripts: set[str] = set()
            confusables: list[str] = []
            out_chars: list[str] = []

            for i, ch in enumerate(tok):
                if ch in _ZERO_WIDTH_CHARS:
                    if not _is_legitimate_script_joiner(tok, i):
                        confusables.append(f"U+{ord(ch):04X}")
                    else:
                        out_chars.append(ch)
                    continue
                sc = _char_script(ch)
                if sc:
                    scripts.add(sc)
                if ch in _UTS39_SKELETON_MAP:
                    confusables.append(f"{ch}(U+{ord(ch):04X})")
                    out_chars.append(_UTS39_SKELETON_MAP[ch])
                else:
                    out_chars.append(ch)

            mixed_spoof = "LATIN" in scripts and any(s in ("CYRILLIC", "GREEK") for s in scripts)
            full_homoglyph = (
                any(s in ("CYRILLIC", "GREEK") for s in scripts)
                and any(ch in _UTS39_SKELETON_MAP for ch in tok)
                and all(ch.isascii() or ch in _UTS39_SKELETON_MAP or ch in _ZERO_WIDTH_CHARS for ch in tok)
            )
            zw_spoof = any(c.startswith("U+") for c in confusables)
            if not (mixed_spoof or full_homoglyph or zw_spoof):
                continue

            skeleton = unicodedata.normalize("NFKC", "".join(out_chars))
            replacement = skeleton
            rule_ref = Rule(
                rule_id="unicode-confusable-uts39",
                rule_type="security",
                source_text="Prevent homoglyph and invisible zero-width character spoofing",
            )
            severity = 85
            for tr in canon.terminology:
                if tr.pattern.search(skeleton):
                    replacement = tr.preferred
                    rule_ref = canon.to_rule_ref(tr)
                    severity = max(severity, tr.severity)
                    break

            span = Span(start=m.start(), end=m.end())
            findings.append(
                self.finding(
                    node=node,
                    locator=span,
                    message=f"Unicode homoglyph/stealth obfuscation in {tok!r} -> {skeleton!r}",
                    severity=severity,
                    rule_ref=rule_ref,
                    evidence=ConfusableEvidence(
                        spoofed_token=tok,
                        skeleton_token=skeleton,
                        confusable_chars=tuple(confusables),
                        scripts=tuple(sorted(scripts)),
                    ),
                    suggestion=Suggestion(
                        summary=f"Normalize spoofed token to {replacement!r}",
                        patch=Replace(start=m.start(), end=m.end(), new_text=replacement),
                        auto_applicable=True,
                    ),
                    canon=canon,
                )
            )
        return findings

