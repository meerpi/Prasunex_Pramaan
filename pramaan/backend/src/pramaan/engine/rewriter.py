"""Tier 3 Constrained Surgical Rewriter with Outbound PII-Scrubbed LLM Dispatch & Document Re-Verification."""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
from rapidfuzz import fuzz

from pramaan.domain import (
    Canon,
    ContentAST,
    Finding,
    MathContradictionEvidence,
    Replace,
    SlotDiffEvidence,
    Span,
    TextNode,
    TriggerObligationEvidence,
    default_pii_scrubber,
)


@dataclass(frozen=True, slots=True)
class RewriteResult:
    original_text: str
    rewritten_text: str
    masked_prompt_preview: str
    edit_distance_ratio: float
    max_edit_distance_ratio: float
    reverified: bool
    remaining_findings_count: int
    pii_masked_count: int
    used_provider: str
    api_key_configured: bool
    provider_notice: str
    quality_gates: dict[str, bool] = field(default_factory=dict)


def _patch_math_contradiction(node_text: str, finding: Finding, ev: MathContradictionEvidence) -> str:
    expected_clean = re.sub(r"^(?:<=|>=|==|<|>)\s*", "", ev.expected_value.strip())
    if not expected_clean or not re.search(r"\d", expected_clean):
        return node_text

    loc = finding.locator
    if isinstance(loc, Span) and 0 <= loc.start < loc.end <= len(node_text):
        span_text = node_text[loc.start : loc.end]
        if expected_clean.endswith("%") and re.search(r"\d+(?:\.\d+)?\s*%", span_text):
            patched = re.sub(r"\d+(?:\.\d+)?\s*%", expected_clean, span_text, count=1)
            return node_text[: loc.start] + patched + node_text[loc.end :]
        if "/" in expected_clean and re.search(r"\d[\d,]*\s*/\s*\d[\d,]*", span_text):
            patched = re.sub(r"\d[\d,]*\s*/\s*\d[\d,]*", expected_clean, span_text, count=1)
            return node_text[: loc.start] + patched + node_text[loc.end :]
        if span_text.strip() == ev.observed_value.strip():
            return node_text[: loc.start] + expected_clean + node_text[loc.end :]
        if re.search(r"\d+(?:\.\d+)?", span_text):
            patched = re.sub(r"\d+(?:\.\d+)?", expected_clean, span_text, count=1)
            return node_text[: loc.start] + patched + node_text[loc.end :]
        return node_text[: loc.start] + expected_clean + node_text[loc.end :]

    obs = ev.observed_value.strip()
    if obs and obs in node_text:
        return node_text.replace(obs, expected_clean, 1)
    return node_text


def _deterministic_surgical_patch(node_text: str, finding: Finding) -> str:
    ev = finding.evidence
    if finding.suggestion and isinstance(finding.suggestion.patch, Replace):
        p = finding.suggestion.patch
        if 0 <= p.start <= p.end <= len(node_text):
            return node_text[: p.start] + p.new_text + node_text[p.end :]

    if isinstance(ev, TriggerObligationEvidence):
        req = ev.required_disclaimer_text.strip()
        if req and req.lower() not in node_text.lower():
            return f"{node_text.rstrip()} ({req})."

    if isinstance(ev, SlotDiffEvidence):
        return ev.canon_text

    if isinstance(ev, MathContradictionEvidence):
        return _patch_math_contradiction(node_text, finding, ev)

    return node_text


def _is_offline_only() -> bool:
    raw = os.environ.get("PRAMAAN_OFFLINE_ONLY")
    if raw is None or not raw.strip():
        return True
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _dispatch_scrubbed_llm(
    *,
    masked_text: str,
    finding: Finding,
    placeholder_keys: list[str],
) -> tuple[str | None, str, str]:
    """Send ONLY PII-masked text (`masked_text`) to configured outbound LLM provider via httpx."""
    if _is_offline_only():
        return (
            None,
            "airgapped-deterministic-surgical",
            "Air-Gapped Local Mode (PRAMAAN_OFFLINE_ONLY=true): outbound LLM dispatch disabled; synthesized locally via constrained surgical AST rewriter.",
        )

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = (
        os.environ.get("OPENAI_API_KEY", "").strip()
        or os.environ.get("PRAMAAN_LLM_API_KEY", "").strip()
    )
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()

    if not (gemini_key or openai_key or openrouter_key):
        return (
            None,
            "airgapped-deterministic-surgical",
            "Air-Gapped Local Mode: no outbound LLM key configured; synthesized locally via constrained surgical AST rewriter.",
        )

    suggestion_hint = finding.suggestion.summary if finding.suggestion else ""
    ev = finding.evidence
    canon_hint = ""
    if isinstance(ev, TriggerObligationEvidence):
        canon_hint = f"Required statutory disclaimer: {ev.required_disclaimer_text}"
    elif isinstance(ev, SlotDiffEvidence):
        canon_hint = f"Canonical verified fact: {ev.canon_text}"
    elif isinstance(ev, MathContradictionEvidence):
        canon_hint = (
            f"Audited expected value: {ev.expected_value} "
            f"(observed: {ev.observed_value}; rule: {ev.claim_expression})"
        )

    # Scrub metadata hints as well so PII inside finding.message (e.g. SecurityHiddenTextCheck) never leaks outbound.
    safe_message = default_pii_scrubber.scrub(finding.message).masked_text
    safe_canon_hint = default_pii_scrubber.scrub(canon_hint).masked_text if canon_hint else ""
    safe_suggestion_hint = default_pii_scrubber.scrub(suggestion_hint).masked_text if suggestion_hint else ""

    placeholders_rule = (
        f"CRITICAL: You MUST preserve these exact PII placeholder tokens verbatim: {', '.join(placeholder_keys)}."
        if placeholder_keys
        else "No PII placeholders present."
    )
    system_prompt = (
        "You are Pramaan's Constrained Statutory Compliance Rewriter. "
        "Rewrite ONLY the violated span in the user's paragraph so it satisfies the statutory rule. "
        "Return ONLY the rewritten paragraph text with no markdown fences, commentary, or prefixes. "
        f"{placeholders_rule}"
    )
    user_prompt = (
        f"Violated Rule: {finding.rule.rule_id} ({safe_message})\n"
        f"{safe_canon_hint}\n"
        f"Guidance: {safe_suggestion_hint}\n"
        f"Scrubbed Paragraph:\n{masked_text}"
    )

    try:
        with httpx.Client(timeout=8.0) as client:
            if gemini_key:
                model = os.environ.get("PRAMAAN_LLM_MODEL", "").strip() or "gemini-2.5-flash"
                resp = client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    headers={"x-goog-api-key": gemini_key, "Content-Type": "application/json"},
                    json={
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 450},
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                text_out = (
                    (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [{}])[0]
                    .get("text", "")
                    .strip()
                )
                if text_out:
                    return (
                        text_out,
                        f"gemini:{model}",
                        f"Outbound PII-scrubbed repair synthesized via Google Gemini ({model}) and re-verified locally.",
                    )
                if not (openai_key or openrouter_key):
                    return (
                        None,
                        "airgapped-deterministic-surgical",
                        "Outbound Gemini call returned empty candidate; fell back to deterministic surgical AST rewriter.",
                    )

            if openai_key or openrouter_key:
                endpoint = (
                    "https://openrouter.ai/api/v1/chat/completions"
                    if openrouter_key and not openai_key
                    else os.environ.get("PRAMAAN_LLM_BASE_URL", "https://api.openai.com/v1/chat/completions")
                )
                key = openai_key or openrouter_key
                default_model = "openai/gpt-4o-mini" if (openrouter_key and not openai_key) else "gpt-4o-mini"
                model = os.environ.get("PRAMAAN_LLM_MODEL", "").strip() or default_model
                resp = client.post(
                    endpoint,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "temperature": 0.1,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                text_out = (
                    (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                )
                if text_out:
                    provider_tag = f"openrouter:{model}" if (openrouter_key and not openai_key) else f"openai:{model}"
                    return (
                        text_out,
                        provider_tag,
                        f"Outbound PII-scrubbed repair synthesized via {provider_tag} and re-verified locally.",
                    )
    except Exception as exc:
        return (
            None,
            "airgapped-deterministic-surgical",
            f"Outbound PII-scrubbed LLM call unavailable ({type(exc).__name__}); fell back to deterministic surgical AST rewriter.",
        )

    return (
        None,
        "airgapped-deterministic-surgical",
        "Outbound LLM returned empty candidate; fell back to deterministic surgical AST rewriter.",
    )


def rewrite_finding_surgically(
    *,
    ast: ContentAST,
    node: TextNode,
    finding: Finding,
    canon: Canon,
    verify_fn: Callable[[ContentAST, Canon], list[Finding]],
    max_edit_ratio: float = 0.45,
) -> RewriteResult:
    """Apply constrained repair on flagged node with PII scrubbing & full-AST re-verification."""
    scrubbed = default_pii_scrubber.scrub(node.text)

    has_api_key = any(
        bool(os.environ.get(k, "").strip())
        for k in ("PRAMAAN_LLM_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY")
    )

    llm_masked_candidate, used_provider, notice = _dispatch_scrubbed_llm(
        masked_text=scrubbed.masked_text,
        finding=finding,
        placeholder_keys=list(scrubbed.placeholders.keys()),
    )

    restored = ""
    integrity_ok = False
    if llm_masked_candidate:
        try:
            restored = default_pii_scrubber.restore(scrubbed, llm_masked_candidate)
            integrity_ok = True
        except ValueError:
            llm_masked_candidate = None
            used_provider = "airgapped-deterministic-surgical"
            notice = "Outbound LLM candidate dropped a PII placeholder; fell back to deterministic surgical AST rewriter."

    if not llm_masked_candidate:
        candidate_text = _deterministic_surgical_patch(node.text, finding)
        integrity_ok = scrubbed.pii_count == 0 or all(
            val in candidate_text or val not in node.text
            for val in scrubbed.placeholders.values()
        )
        restored = candidate_text if candidate_text else node.text

    ratio = round(1.0 - (fuzz.ratio(node.text, restored) / 100.0), 4)
    # Re-build full ContentAST with updated paragraph and run Tier 1+2 re-verification
    updated_texts = [
        restored if (isinstance(n, TextNode) and n.id == node.id) else (n.text if isinstance(n, TextNode) else "")
        for n in ast.nodes
        if isinstance(n, TextNode)
    ]
    new_ast = ContentAST.from_texts(updated_texts, source_filename=ast.source_filename)
    rem_findings = verify_fn(new_ast, canon)

    target_still_present = any(
        f.check_id == finding.check_id and f.rule.rule_id == finding.rule.rule_id
        for f in rem_findings
    )
    # If outbound LLM failed to resolve the statutory violation, fall back to deterministic AST patch
    if llm_masked_candidate and target_still_present:
        det_candidate = _deterministic_surgical_patch(node.text, finding)
        det_texts = [
            det_candidate if (isinstance(n, TextNode) and n.id == node.id) else (n.text if isinstance(n, TextNode) else "")
            for n in ast.nodes
            if isinstance(n, TextNode)
        ]
        det_ast = ContentAST.from_texts(det_texts, source_filename=ast.source_filename)
        det_findings = verify_fn(det_ast, canon)
        det_still_present = any(
            f.check_id == finding.check_id and f.rule.rule_id == finding.rule.rule_id
            for f in det_findings
        )
        if not det_still_present:
            restored = det_candidate
            rem_findings = det_findings
            target_still_present = False
            ratio = round(1.0 - (fuzz.ratio(node.text, restored) / 100.0), 4)
            used_provider = "airgapped-deterministic-surgical"
            notice = "Outbound LLM candidate did not clear Tier 1/2 check; applied deterministic surgical AST patch."

    reverified = integrity_ok and not target_still_present and bool(restored.strip())

    return RewriteResult(
        original_text=node.text,
        rewritten_text=restored,
        masked_prompt_preview=scrubbed.masked_text[:280],
        edit_distance_ratio=ratio,
        max_edit_distance_ratio=max_edit_ratio,
        reverified=reverified,
        remaining_findings_count=len(rem_findings),
        pii_masked_count=scrubbed.pii_count,
        used_provider=used_provider,
        api_key_configured=has_api_key,
        provider_notice=notice,
        quality_gates={
            "non_empty": bool(restored.strip()),
            "pii_bijection_ok": integrity_ok,
            "target_resolved": not target_still_present,
            "within_edit_ceiling": ratio <= max_edit_ratio or isinstance(finding.evidence, (TriggerObligationEvidence, SlotDiffEvidence)),
        },
    )

