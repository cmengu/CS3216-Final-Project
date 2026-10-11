"""Compatibility imports; Duc's reader now lives in read.reader."""

from read.reader import MAX_BYTES, MAX_PAGES, document_blocks, read_pdf, validate_pdf

__all__ = ["MAX_BYTES", "MAX_PAGES", "document_blocks", "read_pdf", "validate_pdf"]
