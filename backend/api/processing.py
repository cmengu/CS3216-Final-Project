"""The same conservative invoice pipeline for immediate and queued uploads."""

import logging

from pydantic import ValidationError

from read.xml_invoice import read_xml_invoice

log = logging.getLogger(__name__)


class LostLease(RuntimeError):
    """Another worker owns the job; this worker must stop writing results."""


def failure_reason(exc):
    if isinstance(exc, ValueError) and not isinstance(exc, ValidationError):
        return str(exc)
    return f"{type(exc).__name__}: processing failed; inspect the stage and retry"


def process_stored_invoice(
    path, filename, document_hash, selected, reader, save, *, force_ocr=False
):
    stage = "reading"
    try:
        is_xml = filename.lower().endswith(".xml")
        if is_xml:
            document, invoice = read_xml_invoice(path.read_bytes(), filename)
        else:
            document = reader(path, force_ocr=force_ocr)
        if document.document_hash != document_hash:
            raise ValueError("Reader returned a different document hash")
        document.filename = filename
        stage = "extracting"
        save(stage, document=document)
        if not is_xml:
            invoice = selected.extract(document)
        stage = "checking"
        save(stage, invoice=invoice)
        check = selected.check(invoice)
        if is_xml and invoice.warnings:
            check.overcharge_total = None
            check.warnings = list(dict.fromkeys([*check.warnings, *invoice.warnings]))
        if len(check.lines) != len(invoice.lines) or {
            line.line_index for line in check.lines
        } != set(range(len(invoice.lines))):
            raise ValueError("Checker must return exactly one result for every invoice line")
        if check.price_sheet_version != selected.price_sheet_version:
            raise ValueError("Checker returned a different price-sheet version")
        save("completed", check=check)
        return True
    except LostLease:
        raise
    except Exception as exc:
        log.warning("Invoice processing failed (%s)", type(exc).__name__)
        save("failed", error=f"{stage}: {failure_reason(exc)}")
        return False
