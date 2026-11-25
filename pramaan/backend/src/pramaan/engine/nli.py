"""GPU DeBERTa-v3 NLI Engine with Indian Scale Pre-Canonicalization (fixes S4 `e02_year_ay_lakhs_cr`)."""

from __future__ import annotations

import logging
import threading
from collections.abc import Sequence
from dataclasses import dataclass

from pramaan.domain import pre_canonicalize_nli_text
from pramaan.settings import get_settings

logger = logging.getLogger(__name__)

_NLI_MODEL_NAME = "cross-encoder/nli-deberta-v3-base"
_CROSS_ENCODER = None
_ACTIVE_MODEL_LABEL = "deberta-v3-base-canonical"
_NLI_LOCK = threading.Lock()
_NLI_INFER_LOCK = threading.Lock()


def nli_model_status() -> dict[str, object]:
    """Report current CrossEncoder load state without triggering eager model loading."""
    if _CROSS_ENCODER is None:
        state = "unloaded"
    elif _CROSS_ENCODER is False:
        state = "lexical_fallback"
    else:
        state = "loaded"
    return {"model": _NLI_MODEL_NAME, "state": state, "active_label": _ACTIVE_MODEL_LABEL}


@dataclass(frozen=True, slots=True)
class NliPrediction:
    label: str  # "entailed" | "contradiction" | "neutral"
    p_contradiction: float
    p_entailment: float
    p_neutral: float
    model_used: str
    canonical_premise: str
    canonical_hypothesis: str


def _get_nli_model():
    global _CROSS_ENCODER, _ACTIVE_MODEL_LABEL
    if _CROSS_ENCODER is not None:
        return _CROSS_ENCODER if _CROSS_ENCODER is not False else None
    with _NLI_LOCK:
        if _CROSS_ENCODER is not None:
            return _CROSS_ENCODER if _CROSS_ENCODER is not False else None
        try:
            import torch
            from sentence_transformers import CrossEncoder

            device = "cuda" if torch.cuda.is_available() else "cpu"
            offline = get_settings().offline_only
            # Local-cache first so cached weights never trigger unnecessary HF Hub re-downloads
            attempts = (True,) if offline else (True, False)
            model = None
            last_exc: Exception | None = None
            for local_only in attempts:
                kwargs: dict[str, object] = {"local_files_only": local_only}
                if device == "cuda":
                    kwargs["model_kwargs"] = {"dtype": torch.float16}
                try:
                    model = CrossEncoder(_NLI_MODEL_NAME, device=device, **kwargs)
                    break
                except Exception as exc:
                    last_exc = exc
                    try:
                        model = CrossEncoder(_NLI_MODEL_NAME, device=device, local_files_only=local_only)
                        break
                    except Exception as inner_exc:
                        last_exc = inner_exc
            if model is None:
                raise RuntimeError(f"Unable to load {_NLI_MODEL_NAME}: {last_exc}")
            _ACTIVE_MODEL_LABEL = f"deberta-v3-base-{'fp16' if device == 'cuda' else 'fp32'}-canonical"
            _CROSS_ENCODER = model
            return model
        except Exception as exc:
            logger.warning("DeBERTa CrossEncoder unavailable (%s); using deterministic lexical NLI fallback.", exc)
            _ACTIVE_MODEL_LABEL = "lexical-canonical-fallback"
            _CROSS_ENCODER = False
            return None


def _softmax(logits: list[float]) -> tuple[float, float, float]:
    import math

    m = max(logits)
    exps = [math.exp(v - m) for v in logits]
    s = sum(exps) or 1.0
    return (exps[0] / s, exps[1] / s, exps[2] / s)


def _fallback_nli(c_prem: str, c_hyp: str) -> NliPrediction:
    import re

    p_toks = {w.lower() for w in re.findall(r"[A-Za-z0-9\-]+", c_prem) if len(w) >= 2}
    h_toks = {w.lower() for w in re.findall(r"[A-Za-z0-9\-]+", c_hyp) if len(w) >= 2}
    p_nums = {n.replace(",", "") for n in re.findall(r"\binr\s+([\d,]+(?:\.\d+)?)\b", c_prem.lower())}
    h_nums = {n.replace(",", "") for n in re.findall(r"\binr\s+([\d,]+(?:\.\d+)?)\b", c_hyp.lower())}
    neg_flip = ({"not", "never", "no"} & p_toks) != ({"not", "never", "no"} & h_toks)
    num_match = bool(p_nums and p_nums.issubset(h_nums) and not neg_flip)
    overlap = len(p_toks & h_toks) / max(1, len(h_toks))
    if p_nums and h_nums and not p_nums.issubset(h_nums):
        return NliPrediction(
            label="contradiction",
            p_contradiction=0.88,
            p_entailment=0.06,
            p_neutral=0.06,
            model_used="lexical-canonical-fallback",
            canonical_premise=c_prem,
            canonical_hypothesis=c_hyp,
        )
    lbl = "entailed" if (num_match or overlap >= 0.55) and not neg_flip else "neutral"
    return NliPrediction(
        label=lbl,
        p_contradiction=0.04 if lbl == "entailed" else 0.14,
        p_entailment=round(max(0.78 if num_match else 0.0, min(0.95, overlap)), 4),
        p_neutral=0.08 if lbl == "entailed" else 0.72,
        model_used="lexical-canonical-fallback",
        canonical_premise=c_prem,
        canonical_hypothesis=c_hyp,
    )


def score_nli_pairs(pairs: Sequence[tuple[str, str]], *, batch_size: int = 16) -> list[NliPrediction]:
    """Batch NLI evaluation over Indian-unit pre-canonicalized strings."""
    if not pairs:
        return []
    canon_pairs = [(pre_canonicalize_nli_text(p), pre_canonicalize_nli_text(h)) for p, h in pairs]

    model = _get_nli_model()
    if model is not None:
        with _NLI_INFER_LOCK:
            raw_batch = model.predict(canon_pairs, batch_size=batch_size, show_progress_bar=False)
        results: list[NliPrediction] = []
        for (c_prem, c_hyp), raw_logits in zip(canon_pairs, raw_batch, strict=True):
            p_c, p_e, p_n = _softmax([float(raw_logits[0]), float(raw_logits[1]), float(raw_logits[2])])
            if p_c >= p_e and p_c >= p_n and p_c >= 0.45:
                lbl = "contradiction"
            elif p_e >= p_c and p_e >= p_n and p_e >= 0.45:
                lbl = "entailed"
            else:
                lbl = "neutral"
            results.append(
                NliPrediction(
                    label=lbl,
                    p_contradiction=round(p_c, 4),
                    p_entailment=round(p_e, 4),
                    p_neutral=round(p_n, 4),
                    model_used=_ACTIVE_MODEL_LABEL,
                    canonical_premise=c_prem,
                    canonical_hypothesis=c_hyp,
                )
            )
        return results

    return [_fallback_nli(c_prem, c_hyp) for c_prem, c_hyp in canon_pairs]


def score_nli_pair(premise: str, hypothesis: str) -> NliPrediction:
    """Evaluate NLI over Indian-unit pre-canonicalized strings so 1.50 Cr == 150 Lakhs cleanly."""
    return score_nli_pairs([(premise, hypothesis)])[0]
