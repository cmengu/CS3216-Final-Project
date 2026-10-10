"""Conservative invoice-register rules. No LLM decisions, fuzzy joins, or auto-approval."""

import hashlib
import re
from collections import Counter
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .extractor import fields_of
from .schemas import Comparison, ExtractedField, Extraction, Issue, MasterSnapshot

CENT = Decimal("0.01")
SUPPORTED_CURRENCIES = {"SGD", "USD", "EUR", "GBP", "AUD", "MYR", "HKD"}


def key(value: str | None) -> str:
    return " ".join((value or "").split()).upper()


def rounded(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def compare_invoice(extraction: Extraction, snapshot: MasterSnapshot) -> Comparison:
    invoice = extraction.invoice
    issues: list[Issue] = []

    def add(code, path, message, field=None, expected=None, row=None):
        issues.append(
            Issue(
                code=code,
                field=path,
                message=message,
                invoice_value=field.value if field else None,
                master_value=str(expected) if expected is not None else None,
                master_row_id=row,
                evidence=field.evidence if field else [],
            )
        )

    def result(unverifiable=False):
        return Comparison(
            document_hash=extraction.document_hash,
            master_snapshot_id=snapshot.snapshot_id,
            master_snapshot_hash=hashlib.sha256(snapshot.model_dump_json().encode()).hexdigest(),
            status="unable_to_verify" if unverifiable else "needs_review" if issues else "matched",
            issues=issues,
        )

    def number(field: ExtractedField, path: str):
        try:
            if field.value is None or not re.fullmatch(r"\d+(?:\.\d+)?", field.value, re.ASCII):
                raise ValueError()
            value = Decimal(field.value)
            if not value.is_finite() or value < 0 or abs(value) > Decimal("1e12"):
                raise ValueError()
            # Bound precision before multiplication/quantization in downstream arithmetic.
            if value.as_tuple().exponent < -6:
                raise ValueError()
            return value
        except (InvalidOperation, ValueError):
            add("MISSING_OR_INVALID_NUMBER", path, "Expected a non-negative decimal value", field)
            return None

    for message in extraction.grounding_issues:
        add("UNVERIFIED_EVIDENCE", "evidence", message)
    for path, field in fields_of(invoice):
        if field.value is not None and not field.evidence:
            add("MISSING_EVIDENCE", path, "Value needs source evidence", field)
    for warning in invoice.warnings:
        add("EXTRACTION_WARNING", "invoice", warning)
    if invoice.document_type != "invoice":
        add("UNSUPPORTED_DOCUMENT", "document_type", "Only invoices are supported in v1")
        return result(True)
    for name in ("invoice_number", "supplier_id", "currency", "invoice_date"):
        field = getattr(invoice, name)
        if not key(field.value):
            add("MISSING_FIELD", name, "Required invoice field is missing", field)
    try:
        date.fromisoformat(invoice.invoice_date.value or "")
    except ValueError:
        add(
            "INVALID_DATE", "invoice_date", "Expected an unambiguous ISO date", invoice.invoice_date
        )
    currency = key(invoice.currency.value)
    if currency not in SUPPORTED_CURRENCIES:
        add(
            "UNSUPPORTED_CURRENCY",
            "currency",
            "v1 requires a supported two-decimal currency",
            invoice.currency,
        )
    candidates = [
        master
        for master in snapshot.invoices
        if key(master.invoice_number) == key(invoice.invoice_number.value)
        and key(master.supplier_id) == key(invoice.supplier_id.value)
    ]
    if len(candidates) != 1:
        add(
            "MASTER_NOT_FOUND" if not candidates else "AMBIGUOUS_MASTER",
            "invoice_number",
            "Expected exactly one supplier + invoice-number match",
            invoice.invoice_number,
        )
        return result(True)
    master = candidates[0]
    if currency != master.currency:
        add(
            "CURRENCY_MISMATCH",
            "currency",
            "Currency differs; no currency conversion applied",
            invoice.currency,
            master.currency,
        )

    # An inconsistent snapshot is not a trustworthy reference.
    master_valid = (
        all(
            rounded(line.quantity * line.unit_price - line.discount) == line.line_total
            for line in master.lines
        )
        and sum((line.line_total for line in master.lines), Decimal(0)) == master.subtotal
        and rounded(master.subtotal + master.tax_total) == master.grand_total
    )
    if not master_valid:
        add("INVALID_MASTER_TOTALS", "master", "Reference arithmetic is inconsistent")
        return result(True)

    totals = {}
    for name in ("subtotal", "tax_total", "grand_total"):
        field = getattr(invoice, name)
        value = number(field, name)
        totals[name] = value
        if value is not None and value != getattr(master, name):
            add(
                f"{name.upper()}_MISMATCH",
                name,
                "Amount differs from mastersheet",
                field,
                getattr(master, name),
            )
    if all(value is not None for value in totals.values()):
        expected = rounded(totals["subtotal"] + totals["tax_total"])
        if expected != totals["grand_total"]:
            add(
                "INVOICE_TOTAL_ARITHMETIC",
                "grand_total",
                "Subtotal plus tax differs from total",
                invoice.grand_total,
                expected,
            )

    if not invoice.lines:
        add("NO_LINES", "lines", "No invoice lines were extracted")
    counts = Counter(key(line.sku.value) for line in invoice.lines)
    master_counts = Counter(key(line.sku) for line in master.lines)
    present = set()
    line_totals = []
    for index, line in enumerate(invoice.lines):
        prefix = f"lines[{index}]"
        values = {
            name: number(getattr(line, name), f"{prefix}.{name}")
            for name in ("quantity", "unit_price", "discount", "line_total")
        }
        line_totals.append(values["line_total"])
        if all(value is not None for value in values.values()):
            expected = rounded(values["quantity"] * values["unit_price"] - values["discount"])
            if expected != values["line_total"]:
                add(
                    "LINE_ARITHMETIC",
                    f"{prefix}.line_total",
                    "Quantity × price − discount differs",
                    line.line_total,
                    expected,
                )
        sku = key(line.sku.value)
        if not sku:
            add(
                "MISSING_SKU",
                f"{prefix}.sku",
                "A printed SKU is required for exact matching",
                line.sku,
            )
            continue
        present.add(sku)
        if counts[sku] > 1 or master_counts[sku] > 1:
            add(
                "AMBIGUOUS_LINE",
                f"{prefix}.sku",
                "Repeated SKU requires manual line matching",
                line.sku,
            )
            continue
        reference = next((row for row in master.lines if key(row.sku) == sku), None)
        if reference is None:
            add("EXTRA_INVOICE_LINE", f"{prefix}.sku", "SKU has no reference row", line.sku)
            continue
        if not key(line.unit.value) or key(line.unit.value) != key(reference.unit):
            add(
                "UNIT_MISMATCH",
                f"{prefix}.unit",
                "Units differ; no conversion applied",
                line.unit,
                reference.unit,
                reference.row_id,
            )
        for name, value in values.items():
            if value is not None and value != getattr(reference, name):
                add(
                    f"{name.upper()}_MISMATCH",
                    f"{prefix}.{name}",
                    "Value differs from mastersheet",
                    getattr(line, name),
                    getattr(reference, name),
                    reference.row_id,
                )
    for row in master.lines:
        if key(row.sku) not in present:
            add(
                "MISSING_INVOICE_LINE",
                "lines",
                "Mastersheet row has no matching invoice line",
                expected=row.sku,
                row=row.row_id,
            )
    if invoice.lines and all(value is not None for value in line_totals):
        expected = sum(line_totals, Decimal(0))
        if totals["subtotal"] is not None and expected != totals["subtotal"]:
            add(
                "SUBTOTAL_ARITHMETIC",
                "subtotal",
                "Sum of line totals differs from subtotal",
                invoice.subtotal,
                expected,
            )
    return result(currency not in SUPPORTED_CURRENCIES)
