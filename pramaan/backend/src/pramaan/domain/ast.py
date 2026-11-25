"""Pramaan ContentAST: format-agnostic document representation."""

from __future__ import annotations

import re
from collections.abc import Iterator, Sequence
from enum import StrEnum
from typing import Literal

from pramaan.domain.types import FrozenModel, content_hash


class NodeKind(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    HEADING = "heading"
    TABLE_CELL = "table_cell"


class TextNode(FrozenModel, frozen=True):
    """A parsed paragraph, table cell, or OCR text region."""

    id: str
    kind: Literal[NodeKind.TEXT] = NodeKind.TEXT
    path: str
    text: str
    page: int | None = None
    bbox: tuple[float, float, float, float] | None = None
    font_size_pt: float | None = None
    color_hex: str | None = None
    language: str = "en"
    is_hidden: bool = False

    @classmethod
    def from_text(
        cls,
        text: str,
        *,
        path: str = "doc/p[0]",
        page: int | None = None,
        bbox: tuple[float, float, float, float] | None = None,
        font_size_pt: float | None = None,
        color_hex: str | None = None,
        language: str | None = None,
        is_hidden: bool = False,
    ) -> TextNode:
        digest = content_hash(text.encode("utf-8"))[:12]
        detected_lang = language or (
            "hi" if re.search(r"[\u0900-\u097F]", text) else "en"
        )
        return cls(
            id=f"txt_{digest}_{path}",
            path=path,
            text=text,
            page=page,
            bbox=bbox,
            font_size_pt=font_size_pt,
            color_hex=color_hex,
            language=detected_lang,
            is_hidden=is_hidden,
        )


class ImageNode(FrozenModel, frozen=True):
    """An embedded image asset (banner, certificate scan, chart, or QR image)."""

    id: str
    kind: Literal[NodeKind.IMAGE] = NodeKind.IMAGE
    path: str
    asset_path: str
    width: int = 100
    height: int = 100
    alt: str | None = None
    sha256: str = ""

    @classmethod
    def from_bytes(
        cls,
        raw: bytes,
        *,
        path: str,
        width: int = 100,
        height: int = 100,
        alt: str | None = None,
        asset_path: str | None = None,
    ) -> ImageNode:
        digest = content_hash(raw)
        return cls(
            id=f"img_{digest[:12]}",
            path=path,
            asset_path=asset_path or path,
            width=max(1, int(width)),
            height=max(1, int(height)),
            alt=alt,
            sha256=digest,
        )


Node = TextNode | ImageNode


class ContentAST(FrozenModel, frozen=True):
    """Immutable ordered sequence of AST nodes extracted from any campus submission."""

    nodes: tuple[Node, ...] = ()
    source_filename: str = ""
    raw_content: str = ""

    def __len__(self) -> int:
        return len(self.nodes)

    def __iter__(self) -> Iterator[Node]:
        return iter(self.nodes)

    def index_of(self, node_id: str) -> int:
        for i, node in enumerate(self.nodes):
            if node.id == node_id:
                return i
        return len(self.nodes)

    @classmethod
    def from_texts(
        cls,
        texts: Sequence[str],
        *,
        source_filename: str = "inline.md",
    ) -> ContentAST:
        nodes = tuple(
            TextNode.from_text(t, path=f"doc/p[{idx}]")
            for idx, t in enumerate(texts)
            if t is not None
        )
        raw = "\n\n".join(n.text for n in nodes)
        return cls(nodes=nodes, source_filename=source_filename, raw_content=raw)

