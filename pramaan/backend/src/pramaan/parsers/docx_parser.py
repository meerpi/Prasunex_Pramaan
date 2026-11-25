"""DOCX bundle parser via python-docx."""

from __future__ import annotations

import io
import zipfile

from docx import Document

from pramaan.domain.ast import ContentAST, Node, TextNode

_MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024


def parse_docx(raw_bytes: bytes, *, source_filename: str = "document.docx") -> ContentAST:
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            if total_uncompressed > _MAX_DOCX_UNCOMPRESSED_BYTES:
                raise ValueError(f"DOCX uncompressed content exceeds 25 MB limit ({total_uncompressed} bytes)")
        doc = Document(io.BytesIO(raw_bytes))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Corrupt or unreadable DOCX document: {exc}") from exc
    nodes: list[Node] = []
    idx = 0
    for para in doc.paragraphs:
        txt = para.text.strip()
        if txt:
            nodes.append(TextNode.from_text(txt, path=f"docx/p[{idx}]"))
            idx += 1
    for t_idx, tbl in enumerate(doc.tables):
        rows = [[c.text.strip() for c in r.cells] for r in tbl.rows]
        if rows:
            headers = rows[0]
            for r_idx, row in enumerate(rows[1:]):
                lin = " | ".join(
                    f"{headers[c] if c < len(headers) else f'col_{c}'}: {val}"
                    for c, val in enumerate(row)
                    if val
                )
                if lin:
                    nodes.append(TextNode.from_text(lin, path=f"docx/table[{t_idx}_{r_idx}]"))
    raw = "\n\n".join(n.text for n in nodes if isinstance(n, TextNode))
    return ContentAST(nodes=tuple(nodes), source_filename=source_filename, raw_content=raw)

