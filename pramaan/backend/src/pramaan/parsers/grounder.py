"""Trial-3 + S3 XY-Cut Multi-Column Reading Order & Numeric-Guarded Quote Grounder."""

from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from pramaan.parsers.pdf import PdfWordBox

_NUMERIC_TOKEN_RE = re.compile(r"\d+(?:[.,]\d+)?")


@dataclass(frozen=True, slots=True)
class GroundedQuote:
    found: bool
    match_type: str  # "exact" | "fuzzy_contiguous" | "unverified"
    score: float
    page: int | None
    bbox: tuple[float, float, float, float] | None
    matched_words: tuple[PdfWordBox, ...] = ()


def sort_reading_order_xy_cut(
    words: list[PdfWordBox],
    *,
    min_gap_x: float = 24.0,
    min_gap_y: float = 14.0,
    _depth: int = 0,
    _max_depth: int = 32,
) -> list[PdfWordBox]:
    """Recursive XY-Cut ordering so multi-column PDFs read column-by-column cleanly."""
    if len(words) <= 1 or _depth >= _max_depth:
        return _sort_block_lines(words) if len(words) > 1 else list(words)

    # Check vertical column gutter first (split left vs right column cleanly)
    xs = sorted(words, key=lambda w: w.x0)
    max_x_gap = 0.0
    x_split_idx = -1
    running_max_x1 = xs[0].x1
    for i in range(1, len(xs)):
        gap = xs[i].x0 - running_max_x1
        if gap > max_x_gap:
            max_x_gap = gap
            x_split_idx = i
        running_max_x1 = max(running_max_x1, xs[i].x1)

    if max_x_gap >= min_gap_x and 0 < x_split_idx < len(xs):
        left = sort_reading_order_xy_cut(xs[:x_split_idx], min_gap_x=min_gap_x, min_gap_y=min_gap_y, _depth=_depth + 1, _max_depth=_max_depth)
        right = sort_reading_order_xy_cut(xs[x_split_idx:], min_gap_x=min_gap_x, min_gap_y=min_gap_y, _depth=_depth + 1, _max_depth=_max_depth)
        return left + right

    # Otherwise check horizontal paragraph gutter
    ys = sorted(words, key=lambda w: w.y0)
    max_y_gap = 0.0
    y_split_idx = -1
    running_max_y1 = ys[0].y1
    for i in range(1, len(ys)):
        gap = ys[i].y0 - running_max_y1
        if gap > max_y_gap:
            max_y_gap = gap
            y_split_idx = i
        running_max_y1 = max(running_max_y1, ys[i].y1)

    if max_y_gap >= min_gap_y and 0 < y_split_idx < len(ys):
        top = sort_reading_order_xy_cut(ys[:y_split_idx], min_gap_x=min_gap_x, min_gap_y=min_gap_y, _depth=_depth + 1, _max_depth=_max_depth)
        bot = sort_reading_order_xy_cut(ys[y_split_idx:], min_gap_x=min_gap_x, min_gap_y=min_gap_y, _depth=_depth + 1, _max_depth=_max_depth)
        return top + bot

    return _sort_block_lines(words)


def _sort_block_lines(words: list[PdfWordBox]) -> list[PdfWordBox]:
    if not words:
        return []
    by_y = sorted(words, key=lambda w: ((w.y0 + w.y1) * 0.5, w.x0))
    lines: list[list[PdfWordBox]] = []
    cur_line: list[PdfWordBox] = []
    cur_mid = (by_y[0].y0 + by_y[0].y1) * 0.5
    cur_h = max(6.0, by_y[0].y1 - by_y[0].y0)
    for w in by_y:
        mid = (w.y0 + w.y1) * 0.5
        tol = max(5.0, cur_h * 0.6)
        if not cur_line or abs(mid - cur_mid) <= tol:
            cur_line.append(w)
            cur_mid = sum((x.y0 + x.y1) * 0.5 for x in cur_line) / len(cur_line)
            cur_h = max(cur_h, w.y1 - w.y0)
        else:
            lines.append(sorted(cur_line, key=lambda x: x.x0))
            cur_line = [w]
            cur_mid = mid
            cur_h = max(6.0, w.y1 - w.y0)
    if cur_line:
        lines.append(sorted(cur_line, key=lambda x: x.x0))
    return [w for line in lines for w in line]


def _norm_tok(s: str) -> str:
    return re.sub(r"[^\w.%₹$:/-]", "", s.lower()).strip()


def _extract_nums(s: str) -> list[str]:
    return [n.replace(",", "") for n in _NUMERIC_TOKEN_RE.findall(s)]


def ground_quote_on_page(
    quote: str,
    raw_words: list[PdfWordBox],
    *,
    min_score: float = 85.0,
) -> GroundedQuote:
    """Contiguous rapidfuzz sliding-window alignment with strict numeric-forgery protection."""
    if not quote.strip() or not raw_words:
        return GroundedQuote(found=False, match_type="unverified", score=0.0, page=None, bbox=None)

    ordered = sort_reading_order_xy_cut(raw_words)
    q_tokens = [_norm_tok(t) for t in quote.split() if _norm_tok(t)]
    q_nums = _extract_nums(quote)
    if not q_tokens:
        return GroundedQuote(found=False, match_type="unverified", score=0.0, page=None, bbox=None)

    q_joined = " ".join(q_tokens)
    w_norms = [_norm_tok(w.word) for w in ordered]
    win_n = len(q_tokens)

    best_score = 0.0
    best_slice: list[PdfWordBox] = []
    min_w = max(1, win_n - 1)
    max_w = min(len(ordered), win_n + 2)

    for start in range(len(ordered)):
        for length in range(min_w, max_w + 1):
            end = start + length
            if end > len(ordered):
                break
            cand_slice = ordered[start:end]
            cand_str = " ".join(t for t in w_norms[start:end] if t)
            if not cand_str:
                continue

            # Strict numeric guard prevents "14.50 Lakhs" matching "18.50 Lakhs"
            if q_nums:
                c_nums = _extract_nums(cand_str)
                if not all(n in c_nums for n in q_nums):
                    continue

            score = float(fuzz.ratio(q_joined, cand_str))
            if score > best_score:
                best_score = score
                best_slice = cand_slice

    if best_slice and best_score >= min_score:
        ux0 = min(w.x0 for w in best_slice)
        uy0 = min(w.y0 for w in best_slice)
        ux1 = max(w.x1 for w in best_slice)
        uy1 = max(w.y1 for w in best_slice)
        return GroundedQuote(
            found=True,
            match_type="exact" if best_score >= 98.0 else "fuzzy_contiguous",
            score=round(best_score, 2),
            page=best_slice[0].page,
            bbox=(round(ux0, 2), round(uy0, 2), round(ux1, 2), round(uy1, 2)),
            matched_words=tuple(best_slice),
        )

    return GroundedQuote(found=False, match_type="unverified", score=round(best_score, 2), page=None, bbox=None)

