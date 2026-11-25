"""Tier 1 Visual Checks: WCAG Contrast, Alt Text, CIEDE2000 Palette Drift, Logo ORB & Subordination."""

from __future__ import annotations

from typing import ClassVar

import cv2
import numpy as np

from pramaan.checks._vision import (
    delta_e_ciede2000,
    load_rgb_image,
    rgb_to_hex,
    rgb_to_lab,
    wcag_contrast_ratio,
)
from pramaan.domain import (
    BBox,
    Canon,
    ContrastEvidence,
    Finding,
    ImageNode,
    Node,
    NodeKind,
    PaletteMismatch,
    RecolorRegion,
    Rule,
    Suggestion,
    Tier,
)
from pramaan.engine.check import Check


class AccessibilityContrastCheck(Check):
    check_id: ClassVar[str] = "accessibility.wcag_contrast"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.IMAGE})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, ImageNode):
            return []
        findings: list[Finding] = []
        if canon.require_image_alt and not (node.alt or "").strip():
            rule = Rule(rule_id="a11y-alt-text", rule_type="accessibility", source_text="Every image requires non-empty alt text")
            findings.append(
                self.finding(
                    node=node,
                    locator=BBox(x0=0, y0=0, x1=float(node.width), y1=float(node.height)),
                    message=f"Image {node.asset_path!r} is missing descriptive alt text (WCAG 1.1.1).",
                    severity=55,
                    rule_ref=rule,
                    evidence=ContrastEvidence(fg_hex="#000000", bg_hex="#FFFFFF", contrast_ratio=21.0, min_ratio=canon.min_wcag_contrast),
                    canon=canon,
                )
            )

        arr = load_rgb_image(node.asset_path)
        if arr is None or arr.size == 0:
            return findings

        # Sample dominant foreground & background pixels
        h, w = arr.shape[:2]
        corner_samples = np.vstack([arr[0, :, :], arr[-1, :, :], arr[:, 0, :], arr[:, -1, :]])
        bg_rgb = tuple(int(v) for v in np.median(corner_samples, axis=0))
        center = arr[h // 4 : (3 * h) // 4, w // 4 : (3 * w) // 4]
        if center.size > 0:
            flat = center.reshape(-1, 3)
            dists = np.linalg.norm(flat.astype(np.float32) - np.array(bg_rgb, dtype=np.float32), axis=1)
            fg_candidates = flat[dists > 12.0]
            if len(fg_candidates) > 0:
                # Pick percentile cluster furthest toward median foreground contrast
                idx_med = int(np.argsort(dists[dists > 12.0])[len(fg_candidates) // 2])
                fg_rgb = tuple(int(v) for v in fg_candidates[idx_med])
                ratio = wcag_contrast_ratio(fg_rgb, bg_rgb)
                if ratio < canon.min_wcag_contrast:
                    rule_c = Rule(rule_id="a11y-wcag-contrast", rule_type="accessibility", source_text=f"Minimum WCAG 2.1 AA contrast >= {canon.min_wcag_contrast}:1")
                    findings.append(
                        self.finding(
                            node=node,
                            locator=BBox(x0=float(w // 4), y0=float(h // 4), x1=float((3 * w) // 4), y1=float((3 * h) // 4)),
                            message=f"Banner foreground {rgb_to_hex(fg_rgb)} on {rgb_to_hex(bg_rgb)} has contrast {ratio:.2f}:1 (< {canon.min_wcag_contrast}:1).",
                            severity=60,
                            rule_ref=rule_c,
                            evidence=ContrastEvidence(
                                fg_hex=rgb_to_hex(fg_rgb),
                                bg_hex=rgb_to_hex(bg_rgb),
                                contrast_ratio=round(ratio, 2),
                                min_ratio=canon.min_wcag_contrast,
                            ),
                            suggestion=Suggestion(
                                summary=f"Adjust foreground ink to #17142B against {rgb_to_hex(bg_rgb)} background",
                                patch=RecolorRegion(target_hex="#17142B"),
                                auto_applicable=False,
                            ),
                            canon=canon,
                        )
                    )
        return findings


class VisualPaletteDriftCheck(Check):
    check_id: ClassVar[str] = "visual.palette_drift"
    check_version: ClassVar[str] = "2.0"
    tier: ClassVar[Tier] = Tier.TIER_1
    node_kinds: ClassVar[frozenset[NodeKind]] = frozenset({NodeKind.IMAGE})

    def run(self, node: Node, canon: Canon) -> list[Finding]:
        if not isinstance(node, ImageNode) or not canon.palette:
            return []
        arr = load_rgb_image(node.asset_path)
        if arr is None or arr.size == 0:
            return []
        small = cv2.resize(arr, (48, 48), interpolation=cv2.INTER_AREA).reshape(-1, 3)
        # Filter near-white/black neutral canvas and check strongest accent pixels
        sat = np.max(small, axis=1) - np.min(small, axis=1)
        accent_pixels = small[sat > 35]
        if len(accent_pixels) < 8:
            return []
        dom_rgb = tuple(int(v) for v in np.median(accent_pixels, axis=0))
        dom_lab = rgb_to_lab(dom_rgb)

        best_token = None
        best_de = float("inf")
        for tok in canon.palette:
            de = delta_e_ciede2000(dom_lab, rgb_to_lab(tok.rgb))
            if de < best_de:
                best_de = de
                best_token = tok

        if best_token is not None and best_de > best_token.max_delta_e:
            return [
                self.finding(
                    node=node,
                    locator=BBox(x0=0, y0=0, x1=float(node.width), y1=float(node.height)),
                    message=f"Accent color {rgb_to_hex(dom_rgb)} drifts ΔE00={best_de:.1f} from nearest Canon swatch {best_token.name} ({best_token.hex}).",
                    severity=42,
                    rule_ref=canon.to_rule_ref(best_token),
                    evidence=PaletteMismatch(
                        observed_hex=rgb_to_hex(dom_rgb),
                        nearest_token_hex=best_token.hex,
                        delta_e=round(best_de, 2),
                        max_delta_e=best_token.max_delta_e,
                    ),
                    suggestion=Suggestion(
                        summary=f"Recolor accent to Canon swatch {best_token.hex}",
                        patch=RecolorRegion(target_hex=best_token.hex),
                    ),
                    canon=canon,
                )
            ]
        return []
