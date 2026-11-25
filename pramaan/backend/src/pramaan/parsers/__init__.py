"""Permissive multimodal document parsers, OCR, tables, and quote bbox grounder."""

from pramaan.parsers.bundle import BundleParser, default_bundle_parser
from pramaan.parsers.docx_parser import parse_docx
from pramaan.parsers.grounder import GroundedQuote, ground_quote_on_page, sort_reading_order_xy_cut
from pramaan.parsers.html import parse_html
from pramaan.parsers.ocr import OcrLine, OcrResult, ocr_image_bytes, preprocess_scan_image
from pramaan.parsers.pdf import (
    _MAX_PDF_EMBEDDED_IMAGES,
    PdfAnomaly,
    PdfParseResult,
    PdfWordBox,
    build_pdf_text_and_anomaly_nodes,
    extract_word_bboxes_pdfium,
    inspect_pdf,
    render_page_png,
    stamp_qr_onto_pdf,
)
from pramaan.parsers.tables import ExtractedTable, extract_tables_adaptive, parse_markdown_tables
from pramaan.parsers.text import parse_text

__all__ = [
    "BundleParser",
    "ExtractedTable",
    "GroundedQuote",
    "OcrLine",
    "OcrResult",
    "PdfAnomaly",
    "PdfParseResult",
    "PdfWordBox",
    "_MAX_PDF_EMBEDDED_IMAGES",
    "build_pdf_text_and_anomaly_nodes",
    "default_bundle_parser",
    "extract_tables_adaptive",
    "extract_word_bboxes_pdfium",
    "ground_quote_on_page",
    "inspect_pdf",
    "ocr_image_bytes",
    "parse_docx",
    "parse_html",
    "parse_markdown_tables",
    "parse_text",
    "preprocess_scan_image",
    "render_page_png",
    "sort_reading_order_xy_cut",
    "stamp_qr_onto_pdf",
]

