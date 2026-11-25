"""Plain-text & Markdown AST parser with pipe-table linearization."""

from __future__ import annotations

import re

from pramaan.domain.ast import ContentAST, Node, TextNode
from pramaan.parsers.tables import parse_markdown_tables

_BLOCK_SPLIT_RE = re.compile(r"\n{2,}")


def parse_text(raw: str, *, source_filename: str = "inline.md") -> ContentAST:
    """Split text/Markdown into paragraph TextNodes plus linearized pipe-table nodes."""
    blocks = [b.strip() for b in _BLOCK_SPLIT_RE.split(raw or "") if b.strip()]
    nodes: list[Node] = []
    idx = 0
    for block in blocks:
        if "|" in block and "\n" in block:
            tables = parse_markdown_tables(block)
            if tables:
                non_table = [
                    ln.strip()
                    for ln in block.splitlines()
                    if ln.strip() and not ln.strip().startswith("|")
                ]
                if non_table:
                    nodes.append(TextNode.from_text("\n".join(non_table), path=f"doc/p[{idx}]"))
                    idx += 1
                for t_idx, tbl in enumerate(tables):
                    lin = tbl.to_markdown_linear()
                    if lin:
                        nodes.append(TextNode.from_text(lin, path=f"doc/table[{idx}_{t_idx}]"))
                idx += 1
                continue
        nodes.append(TextNode.from_text(block, path=f"doc/p[{idx}]"))
        idx += 1
    return ContentAST(nodes=tuple(nodes), source_filename=source_filename, raw_content=raw)

