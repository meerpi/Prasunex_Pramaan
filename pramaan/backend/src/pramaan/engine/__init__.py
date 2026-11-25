"""Pramaan core reasoning engines: NLI, Split Conformal, Complete-Linkage Graph, RRF, Rewriter & Runner."""

from pramaan.engine.check import Check
from pramaan.engine.claim_graph import (
    CaseType,
    ClaimEdge,
    ClaimGraphResult,
    EdgeType,
    ExtractedFact,
    FactCluster,
    FactProvenance,
    build_complete_linkage_claim_graph,
)
from pramaan.engine.conformal import (
    ConformalCalibrationPoint,
    DualThresholdConformalCalibrator,
    default_calibrator,
)
from pramaan.engine.nli import NliPrediction, score_nli_pair, score_nli_pairs
from pramaan.engine.retriever import AdaptiveHybridRetriever, RetrievedFact, default_retriever
from pramaan.engine.rewriter import RewriteResult, rewrite_finding_surgically
from pramaan.engine.runner import (
    instantiate_checks,
    run_checks_collect,
    run_checks_stream,
    run_checks_sync,
)

__all__ = [
    "AdaptiveHybridRetriever",
    "CaseType",
    "Check",
    "ClaimEdge",
    "ClaimGraphResult",
    "ConformalCalibrationPoint",
    "DualThresholdConformalCalibrator",
    "EdgeType",
    "ExtractedFact",
    "FactCluster",
    "FactProvenance",
    "NliPrediction",
    "RetrievedFact",
    "RewriteResult",
    "build_complete_linkage_claim_graph",
    "default_calibrator",
    "default_retriever",
    "instantiate_checks",
    "rewrite_finding_surgically",
    "run_checks_collect",
    "run_checks_stream",
    "run_checks_sync",
    "score_nli_pair",
    "score_nli_pairs",
]
