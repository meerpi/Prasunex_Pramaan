"""Unified multimodal BundleParser routing text, HTML, DOCX, PDF (with S2 OCR + tables), and Images."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from pramaan.domain.ast import ContentAST, ImageNode, Node, TextNode
from pramaan.parsers.docx_parser import parse_docx
from pramaan.parsers.html import parse_html
from pramaan.parsers.ocr import ocr_image_bytes
from pramaan.parsers.pdf import build_pdf_text_and_anomaly_nodes
from pramaan.parsers.tables import extract_tables_adaptive
from pramaan.parsers.text import parse_text

_IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".webp"})


class BundleParser:
    """Format-agnostic ContentAST builder uniting CanonGate and Pramaan Stage 0/1 parsers."""

    def __init__(self, *, artifact_dir: Path | None = None) -> None:
        self.artifact_dir = artifact_dir

    def parse_one(self, asset: tuple[str, bytes]) -> ContentAST:
        filename, raw = asset
        ext = Path(filename).suffix.lower()

        if ext in (".txt", ".md", ".markdown", ".yaml", ".yml", ".json", ".csv"):
            return parse_text(raw.decode("utf-8", errors="replace"), source_filename=filename)

        if ext in (".html", ".htm"):
            return parse_html(raw.decode("utf-8", errors="replace"), source_filename=filename)

        if ext == ".docx":
            return parse_docx(raw, source_filename=filename)

        if ext == ".pdf":
            parsed, nodes, _visible_parts, ocr_by_page, _anoms = build_pdf_text_and_anomaly_nodes(
                raw, extract_images=True
            )

            for t_idx, tbl in enumerate(extract_tables_adaptive(raw, pre_ocr=ocr_by_page)):
                lin = tbl.to_markdown_linear()
                if lin:
                    nodes.append(TextNode.from_text(lin, path=f"pdf/table[{tbl.page}_{t_idx}]", page=tbl.page))

            for i_idx, (iname, ibytes) in enumerate(parsed.embedded_image_bytes):
                out_path = iname
                if self.artifact_dir is not None:
                    self.artifact_dir.mkdir(parents=True, exist_ok=True)
                    dest = self.artifact_dir / f"pdf_img_{i_idx}_{Path(iname).name}"
                    dest.write_bytes(ibytes)
                    out_path = str(dest.resolve())
                w, h = 100, 100
                try:
                    with Image.open(io.BytesIO(ibytes)) as im:
                        w, h = im.size
                except Exception:
                    pass
                nodes.append(
                    ImageNode.from_bytes(ibytes, path=f"pdf/img[{i_idx}]", asset_path=out_path, width=w, height=h)
                )

            raw_joined = "\n\n".join(n.text for n in nodes if isinstance(n, TextNode))
            return ContentAST(nodes=tuple(nodes), source_filename=filename, raw_content=raw_joined)

        if ext in _IMAGE_EXTS:
            w, h = 100, 100
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    w, h = im.size
            except Exception:
                pass
            out_path = filename
            if self.artifact_dir is not None:
                self.artifact_dir.mkdir(parents=True, exist_ok=True)
                dest = self.artifact_dir / Path(filename).name
                dest.write_bytes(raw)
                out_path = str(dest.resolve())
            nodes_img: list[Node] = [
                ImageNode.from_bytes(raw, path=f"img/{Path(filename).name}", asset_path=out_path, width=w, height=h)
            ]
            ocr = ocr_image_bytes(raw, sweep_orientations=True)
            if ocr.full_text.strip():
                nodes_img.append(TextNode.from_text(ocr.full_text.strip(), path="img/ocr[0]", page=0))
            return ContentAST(
                nodes=tuple(nodes_img),
                source_filename=filename,
                raw_content=ocr.full_text.strip(),
            )

        return parse_text(raw.decode("utf-8", errors="replace"), source_filename=filename)


default_bundle_parser = BundleParser()

