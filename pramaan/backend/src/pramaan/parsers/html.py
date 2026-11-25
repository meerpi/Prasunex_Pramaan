"""HTML bundle parser with CSS hidden-block & missing-alt detection."""

from __future__ import annotations

import re
from html.parser import HTMLParser

from pramaan.domain.ast import ContentAST, ImageNode, Node, TextNode

_HIDDEN_STYLE_RE = re.compile(
    r"(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:\s*;|$)|font-size\s*:\s*[01](?:\.\d+)?px)",
    re.IGNORECASE,
)


_VOID_TAGS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)
_SKIP_TEXT_TAGS = frozenset({"script", "style"})


class _AstHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.nodes: list[Node] = []
        self._hidden_depth = 0
        self._skip_depth = 0
        self._buf: list[str] = []
        self._idx = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        low_tag = tag.lower()
        if low_tag in _SKIP_TEXT_TAGS:
            self._skip_depth += 1
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        style = attr_map.get("style", "")
        is_hidden = self._hidden_depth > 0 or bool(_HIDDEN_STYLE_RE.search(style)) or "hidden" in attr_map
        if is_hidden and low_tag not in _VOID_TAGS:
            self._hidden_depth += 1

        if low_tag == "img":
            raw_src = attr_map.get("src", "image.png").strip()
            # Reject filesystem paths and traversal attempts inside HTML image tags
            safe_src = raw_src if (raw_src.startswith("data:image/") or ("://" not in raw_src and not raw_src.startswith("/") and ".." not in raw_src)) else "untrusted_external_image.png"
            alt = attr_map.get("alt")
            self.nodes.append(
                ImageNode.from_bytes(
                    safe_src.encode("utf-8"),
                    path=f"html/hidden_img[{self._idx}]" if is_hidden else f"html/img[{self._idx}]",
                    asset_path=safe_src,
                    alt=alt,
                )
            )
            self._idx += 1

    def handle_endtag(self, tag: str) -> None:
        low_tag = tag.lower()
        if low_tag in _SKIP_TEXT_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            self._buf.clear()
            return
        if low_tag in _VOID_TAGS:
            return
        txt = " ".join("".join(self._buf).split()).strip()
        self._buf.clear()
        if txt:
            if self._hidden_depth > 0:
                self.nodes.append(
                    TextNode.from_text(
                        txt,
                        path=f"html/hidden[{self._idx}]",
                        is_hidden=True,
                    )
                )
            else:
                self.nodes.append(TextNode.from_text(txt, path=f"html/p[{self._idx}]"))
            self._idx += 1
        if self._hidden_depth > 0:
            self._hidden_depth = max(0, self._hidden_depth - 1)

    def handle_data(self, data: str) -> None:
        if data and self._skip_depth == 0:
            self._buf.append(data)


def parse_html(raw_html: str, *, source_filename: str = "page.html") -> ContentAST:
    parser = _AstHtmlParser()
    parser.feed(raw_html)
    parser.close()
    raw = "\n\n".join(n.text for n in parser.nodes if isinstance(n, TextNode))
    return ContentAST(nodes=tuple(parser.nodes), source_filename=source_filename, raw_content=raw)

