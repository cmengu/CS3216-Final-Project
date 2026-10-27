"""Conservative grounding for invoices that print only a final CPT total."""

import re
from decimal import Decimal


def ground_total_only_invoice(record, markdown: str):
    # CPT totals include delivery charges. A preceding goods amount is not a subtotal.
    # Require explicit final-total evidence and absence of any subtotal/tax label.
    if not re.search(r"\bTOTAL\s+CPT\b", markdown, re.I):
        return record
    if re.search(r"\b(?:sub\s*-?\s*total|GST|VAT|tax)\b", markdown, re.I):
        return record
    record.subtotal = None
    record.tax = None
    if hasattr(record, "tax_rate"):
        record.tax_rate = None
    return record


def fill_missing_totals(record):
    """Apply the configured display/check defaults without replacing printed values."""
    if record.tax is None:
        record.tax = "0.00"
    if (
        record.subtotal is None
        and record.lines
        and all(line.line_total is not None for line in record.lines)
    ):
        record.subtotal = format(
            sum((Decimal(line.line_total) for line in record.lines), Decimal(0)), "f"
        )
    return record
