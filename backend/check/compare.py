"""Mark each invoice line against the price sheet. Exact decimals, one result per line."""

from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from api.contracts import CheckResult
from schema import InvoiceLine, InvoiceRecord

from .sheet import PriceSheet, load_price_sheet

DEFAULT_SHEET = Path(__file__).resolve().parents[2] / "data" / "dummy" / "price-sheet.xlsx"


def money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def plain(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def check(invoice: InvoiceRecord, sheet: PriceSheet | None = None) -> CheckResult:
    loaded = load_price_sheet(DEFAULT_SHEET) if sheet is None else sheet
    lines = [_line(index, line, invoice.currency, loaded) for index, line in enumerate(invoice.lines)]
    if _invoice_sums_fail(invoice):
        for line in lines:
            line["status"] = "needs_person"
            line["reason"] = "Invoice arithmetic does not reconcile"
            line["overcharge"] = None
        warnings = ["Invoice arithmetic does not reconcile"]
        total = None
    else:
        warnings = []
        if any(line["overcharge"] is None for line in lines):
            total = None
        else:
            total = money(sum((Decimal(line["overcharge"]) for line in lines), Decimal(0)))
    return CheckResult(
        price_sheet_version=loaded.version,
        lines=lines,
        overcharge_total=total,
        warnings=warnings,
    )


def _line(index: int, line: InvoiceLine, currency: str | None, sheet: PriceSheet) -> dict:
    found = sheet.lookup(line.part_number)
    invoice_price = line.unit_price
    agreed, difference = _prices(line, found)
    missing = _missing(line)
    if missing:
        return _result(
            index,
            "needs_person",
            f"{missing} is missing",
            invoice_price,
            agreed,
            difference,
            None,
        )
    if _line_arithmetic_fails(line):
        return _result(
            index,
            "needs_person",
            "Quantity times price does not equal line total",
            invoice_price,
            agreed,
            difference,
            None,
        )
    if found is None:
        return _result(
            index,
            "unknown_part",
            "Part is absent from dummy price sheet",
            invoice_price,
            None,
            None,
            None,
        )
    if _currency_differs(currency, found.currency):
        return _result(
            index,
            "needs_person",
            "currency differs",
            invoice_price,
            agreed,
            difference,
            None,
        )
    gap = Decimal(invoice_price) - found.unit_price
    if gap != 0:
        return _result(
            index,
            "price_mismatch",
            "Billed unit price differs from agreed price",
            invoice_price,
            agreed,
            plain(gap),
            money(max(gap, Decimal(0)) * Decimal(line.quantity)),
        )
    return _result(
        index,
        "match",
        "Agreed unit price",
        invoice_price,
        invoice_price,
        "0",
        "0.00",
    )


def _prices(line: InvoiceLine, found):
    if found is None or line.unit_price is None:
        agreed = None if found is None else found.unit_price_text
        return agreed, None
    gap = Decimal(line.unit_price) - found.unit_price
    agreed = line.unit_price if gap == 0 else found.unit_price_text
    return agreed, plain(gap)


def _missing(line: InvoiceLine) -> str | None:
    if line.part_number is None or not line.part_number.strip():
        return "Part number"
    if line.quantity is None:
        return "Quantity"
    if line.unit_price is None:
        return "Unit price"
    if line.line_total is None:
        return "Line total"
    return None


def _line_arithmetic_fails(line: InvoiceLine) -> bool:
    product = Decimal(line.quantity) * Decimal(line.unit_price)
    return product != Decimal(line.line_total)


def _currency_differs(invoice_currency: str | None, sheet_currency: str) -> bool:
    if invoice_currency is None or not invoice_currency.strip():
        return True
    return invoice_currency.strip().casefold() != sheet_currency.strip().casefold()


def _invoice_sums_fail(invoice: InvoiceRecord) -> bool:
    if invoice.subtotal is None or invoice.tax is None or invoice.invoice_total is None:
        return True
    if any(line.line_total is None for line in invoice.lines):
        return False
    subtotal = sum((Decimal(line.line_total) for line in invoice.lines), Decimal(0))
    if subtotal != Decimal(invoice.subtotal):
        return True
    return Decimal(invoice.subtotal) + Decimal(invoice.tax) != Decimal(invoice.invoice_total)


def _result(index, status, reason, invoice_price, agreed, difference, overcharge) -> dict:
    return {
        "line_index": index,
        "status": status,
        "reason": reason,
        "invoice_price": invoice_price,
        "agreed_price": agreed,
        "difference": difference,
        "overcharge": overcharge,
    }
