"""Adaptive Code-Gated BM25 + all-MiniLM-L6-v2 RRF Hybrid Fact Retriever (S5 Fix)."""

from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from rank_bm25 import BM25Okapi

from pramaan.domain import FactClaim
from pramaan.settings import get_settings

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[A-Za-z0-9_.\-%₹$]+")
_CODE_OR_ID_RE = re.compile(
    r"(?:\b[A-Z]{2,}[-\s]?\d{2,}\b|\b\d{4}[A-Z]{2,5}\d{3,}\b|\bCRITERIA?(?:ON)?[-\s]*[IVX]+\b|\b(?:NAAC|AISHE|UGC|NIRF)\b|\bFY\s*\d{2,4}|\bAY\s*\d{2,4}|Rs\.?\s*\d)",
    re.IGNORECASE,
)

_EMBED_MODEL = None
_EMBED_LOCK = threading.Lock()
_EMBED_INFER_LOCK = threading.Lock()
_INDEX_LOCK = threading.Lock()
_FACT_INDEX_MAX = 128
_FACT_INDEX_CACHE: OrderedDict[
    tuple[bool, tuple[tuple[str, str, str, tuple[str, ...]], ...]],
    tuple[list[str], list[list[str]], BM25Okapi, np.ndarray],
] = OrderedDict()


def embedder_status() -> dict[str, object]:
    """Report dense embedder load state without forcing eager model loading."""
    if _EMBED_MODEL is None:
        state = "unloaded"
    elif _EMBED_MODEL is False:
        state = "hashed_fallback"
    else:
        state = "loaded"
    return {"model": "sentence-transformers/all-MiniLM-L6-v2", "state": state}


def _get_embedder():
    global _EMBED_MODEL
    if _EMBED_MODEL is not None:
        return _EMBED_MODEL if _EMBED_MODEL is not False else None
    with _EMBED_LOCK:
        if _EMBED_MODEL is not None:
            return _EMBED_MODEL if _EMBED_MODEL is not False else None
        try:
            from sentence_transformers import SentenceTransformer

            model_name = "sentence-transformers/all-MiniLM-L6-v2"
            try:
                _EMBED_MODEL = SentenceTransformer(model_name, local_files_only=True)
            except Exception:
                if get_settings().offline_only:
                    raise
                _EMBED_MODEL = SentenceTransformer(model_name, local_files_only=False)
            return _EMBED_MODEL
        except Exception as exc:
            logger.warning("MiniLM embedder unavailable (%s); using hashed semantic projection.", exc)
            _EMBED_MODEL = False
            return None


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text)]


def _hash_vec(text: str, dim: int = 128) -> np.ndarray:
    vec = np.zeros(dim, dtype=np.float32)
    for tok in _tokenize(text):
        h = hash(tok) % dim
        vec[h] += 1.0
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else vec


@dataclass(frozen=True, slots=True)
class RetrievedFact:
    fact: FactClaim
    score: float
    bm25_rank: int
    dense_rank: int
    mode: str  # "code_gated" | "semantic_paraphrase"


class AdaptiveHybridRetriever:
    """Query-gated BM25 + dense vector Reciprocal Rank Fusion retriever."""

    def retrieve(
        self,
        query: str,
        facts: Sequence[FactClaim],
        *,
        top_k: int = 3,
    ) -> list[RetrievedFact]:
        if not facts or not query.strip():
            return []

        embedder = _get_embedder()
        fact_key = (
            embedder is not None,
            tuple((f.id, f.subject_product, f.text, tuple(f.conditions)) for f in facts),
        )
        with _INDEX_LOCK:
            cached = _FACT_INDEX_CACHE.get(fact_key)
            if cached is not None:
                _FACT_INDEX_CACHE.move_to_end(fact_key)
        if cached is not None:
            docs, tok_docs, bm25, d_vecs = cached
        else:
            docs = [f"{f.id} {f.subject_product} {f.text} {' '.join(f.conditions)}" for f in facts]
            tok_docs = [_tokenize(d) for d in docs]
            bm25 = BM25Okapi(tok_docs)
            if embedder is not None:
                with _EMBED_INFER_LOCK:
                    d_vecs = embedder.encode(docs, normalize_embeddings=True, show_progress_bar=False)
            else:
                d_vecs = np.vstack([_hash_vec(d) for d in docs])
            with _INDEX_LOCK:
                _FACT_INDEX_CACHE[fact_key] = (docs, tok_docs, bm25, d_vecs)
                _FACT_INDEX_CACHE.move_to_end(fact_key)
                while len(_FACT_INDEX_CACHE) > _FACT_INDEX_MAX:
                    _FACT_INDEX_CACHE.popitem(last=False)

        q_toks = _tokenize(query)
        q_set = set(q_toks)
        raw_bm25 = np.asarray(bm25.get_scores(q_toks), dtype=float)
        # Ensure non-zero lexical tiebreaking for tiny corpora (N <= 3 where standard RSJ IDF == 0)
        lex_overlap = np.asarray(
            [len(q_set & set(dtok)) / max(1, len(q_set)) for dtok in tok_docs],
            dtype=float,
        )
        bm25_scores = np.maximum(raw_bm25, 0.0) + 0.5 * lex_overlap
        bm25_order = np.argsort(-bm25_scores)

        if embedder is not None:
            with _EMBED_INFER_LOCK:
                q_vec = embedder.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]
        else:
            q_vec = _hash_vec(query)
        dense_scores = np.dot(d_vecs, q_vec)
        dense_order = np.argsort(-dense_scores)

        is_code_query = bool(_CODE_OR_ID_RE.search(query))
        w_bm25, w_dense = (0.72, 0.28) if is_code_query else (0.32, 0.68)
        mode = "code_gated" if is_code_query else "semantic_paraphrase"

        bm25_rank_map = {int(idx): rank + 1 for rank, idx in enumerate(bm25_order)}
        dense_rank_map = {int(idx): rank + 1 for rank, idx in enumerate(dense_order)}

        rrf_k = 20.0
        scored: list[RetrievedFact] = []
        for idx, f in enumerate(facts):
            rb = bm25_rank_map[idx]
            rd = dense_rank_map[idx]
            rrf = w_bm25 * (1.0 / (rrf_k + rb)) + w_dense * (1.0 / (rrf_k + rd))
            scored.append(
                RetrievedFact(
                    fact=f,
                    score=round(float(rrf), 6),
                    bm25_rank=rb,
                    dense_rank=rd,
                    mode=mode,
                )
            )
        scored.sort(key=lambda item: item.score, reverse=True)
        return scored[: max(1, top_k)]


default_retriever = AdaptiveHybridRetriever()
