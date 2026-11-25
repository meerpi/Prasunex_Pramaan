"""Vectorized Krippendorff's Alpha & Empirical Bayes Rule Friction Scoring (Permissive MIT-clean NumPy)."""

from __future__ import annotations

import numpy as np

from pramaan.domain import compute_rule_friction

__all__ = ["compute_rule_friction", "krippendorff_alpha"]


def krippendorff_alpha(reliability_matrix: np.ndarray) -> float:
    """Compute nominal Krippendorff's alpha from shape `(n_coders, n_units)` with NaN for missing."""
    mat = np.asarray(reliability_matrix, dtype=float)
    if mat.ndim != 2:
        raise ValueError("reliability_matrix must be 2D")
    valid = ~np.isnan(mat)
    # Count only units rated by >= 2 coders
    m_u = valid.sum(axis=0)
    use_cols = m_u >= 2
    if not np.any(use_cols):
        return 1.0
    mat = mat[:, use_cols]
    valid = valid[:, use_cols]
    m_u = valid.sum(axis=0)

    vals = np.unique(mat[valid])
    if len(vals) <= 1:
        return 1.0
    val_to_idx = {v: i for i, v in enumerate(vals)}
    V = len(vals)
    coincidence = np.zeros((V, V), dtype=float)

    for col in range(mat.shape[1]):
        col_vals = mat[valid[:, col], col]
        m = len(col_vals)
        idxs = [val_to_idx[float(v)] for v in col_vals]
        for i in range(m):
            for j in range(m):
                if i != j:
                    coincidence[idxs[i], idxs[j]] += 1.0 / (m - 1.0)

    n_total = coincidence.sum()
    if n_total <= 0:
        return 1.0
    D_o = (n_total - np.trace(coincidence)) / n_total
    marginals = coincidence.sum(axis=1)
    D_e = (n_total * n_total - float(np.sum(marginals * marginals))) / max(1e-12, n_total * (n_total - 1.0))
    if D_e <= 1e-12:
        return 1.0
    return round(float(1.0 - D_o / D_e), 4)
