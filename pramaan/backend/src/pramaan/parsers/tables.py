"""Trial-2 Adaptive 3-Path Table Router (`markdown_pipe` / `pdfplumber_vector` / `ocr_spatial`)."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

import pdfplumber

from pramaan.parsers.ocr import ocr_image_bytes
from pramaan.parsers.pdf import render_page_png

_PIPE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_SEP_ROW_RE = re.compile(r"^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$")


@dataclass(frozen=True, slots=True)
class ExtractedTable:
    headers: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    page: int
    route_used: str  # "markdown_pipe" | "pdfplumber_vector" | "ocr_spatial"

    def to_markdown_linear(self) -> str:
        if not self.rows:
            return ""
        lines: list[str] = []
        for row in self.rows:
            pairs = [
                f"{self.headers[i] if i < len(self.headers) else f'col_{i}'}: {cell}"
                for i, cell in enumerate(row)
                if cell
            ]
            if pairs:
                lines.append(" | ".join(pairs))
        return "\n".join(lines)


def parse_markdown_tables(text: str) -> list[ExtractedTable]:
    lines = text.splitlines()
    tables: list[ExtractedTable] = []
    i = 0
    while i < len(lines):
        if _PIPE_ROW_RE.match(lines[i]):
            block: list[list[str]] = []
            while i < len(lines) and _PIPE_ROW_RE.match(lines[i]):
                if not _SEP_ROW_RE.match(lines[i]):
                    cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                    block.append(cells)
                i += 1
            if len(block) >= 2:
                tables.append(
                    ExtractedTable(
                        headers=tuple(block[0]),
                        rows=tuple(tuple(r) for r in block[1:]),
                        page=0,
                        route_used="markdown_pipe",
                    )
                )
        else:
            i += 1
    return tables


def extract_tables_adaptive(
    pdf_source: bytes,
    *,
    page_num: int | None = None,
    pre_ocr: dict[int, object] | None = None,
    skip_ocr: bool = False,
) -> list[ExtractedTable]:
    """Adaptive router: vector lattice/stream via pdfplumber first, reusing pre-OCR before fallback."""
    results: list[ExtractedTable] = []
    with pdfplumber.open(io.BytesIO(pdf_source)) as pdoc:
        indices = [page_num] if page_num is not None else list(range(len(pdoc.pages)))
        for p_idx in indices:
            if p_idx < 0 or p_idx >= len(pdoc.pages):
                continue
            page = pdoc.pages[p_idx]
            raw_tables = page.extract_tables() or []
            if raw_tables:
                for tbl in raw_tables:
                    cleaned = [
                        [str(c or "").replace("\n", " ").strip() for c in row]
                        for row in tbl
                        if row and any(str(c or "").strip() for c in row)
                    ]
                    if len(cleaned) >= 2:
                        results.append(
                            ExtractedTable(
                                headers=tuple(cleaned[0]),
                                rows=tuple(tuple(r) for r in cleaned[1:]),
                                page=p_idx,
                                route_used="pdfplumber_vector",
                            )
                        )
                continue

            # Scanned / borderless image page fallback -> reuse pre_ocr when available (no double OCR)
            if not skip_ocr and len((page.extract_text() or "").strip()) < 20:
                ocr = pre_ocr.get(p_idx) if pre_ocr is not None else None
                if ocr is None:
                    png_bytes = render_page_png(pdf_source, p_idx, scale=2.0)
                    ocr = ocr_image_bytes(png_bytes, sweep_orientations=True)
                if len(ocr.lines) >= 2:
                    buckets: dict[int, list[tuple[float, str]]] = {}
                    for ln in ocr.lines:
                        yb = round(((ln.bbox[1] + ln.bbox[3]) * 0.5) / 16.0)
                        buckets.setdefault(yb, []).append((ln.bbox[0], ln.text))
                    rows_txt = [
                        tuple(item[1] for item in sorted(buckets[k], key=lambda x: x[0]))
                        for k in sorted(buckets)
                    ]
                    multi_col = [r for r in rows_txt if len(r) >= 2]
                    if len(multi_col) >= 2:
                        results.append(
                            ExtractedTable(
                                headers=multi_col[0],
                                rows=tuple(multi_col[1:]),
                                page=p_idx,
                                route_used="ocr_spatial",
                            )
                        )
    return results

