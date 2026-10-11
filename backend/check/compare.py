"""Mark each invoice line against the price sheet. Exact decimals, one result per line.

Each line takes the first rule it fails, in this order: a missing number, the line's own
arithmetic, the part lookup, the currency, the price. An invoice whose own sums do not agree
overrides every line, because none of its numbers can be trusted.
"""

from decimal import ROUND_HALF_UP, Decimal

from api.contracts import CheckResult, LineResult
from schema import InvoiceLine, InvoiceRecord

from .allowance import ALLOWANCE
from .sheet import PriceSheet, SheetPrice

SUMS_DISAGREE = "Invoice arithmetic does not reconcile"


def money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def plain(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def check(invoice: InvoiceRecord, sheet: PriceSheet) -> CheckResult:
    lines = [
        _line(index, line, invoice.currency, sheet) for index, line in enumerate(invoice.lines)
    ]
    if _invoice_sums_disagree(invoice):
        stopped = {"status": "needs_person", "reason": SUMS_DISAGREE, "overcharge": None}
        return CheckResult(
            price_sheet_version=sheet.version,
            lines=[line.model_copy(update=stopped) for line in lines],
            overcharge_total=None,
            warnings=[SUMS_DISAGREE],
        )
    # The total is what can be claimed today: the overcharges that are known. Lines with no
    # known price are left out of it and counted in a warning, so the total is not read as final.
    known = [Decimal(line.overcharge) for line in lines if line.overcharge is not None]
    unpriced = len(lines) - len(known)
    return CheckResult(
        price_sheet_version=sheet.version,
        lines=lines,
        overcharge_total=money(sum(known, Decimal(0))),
        warnings=[not_priced(unpriced)] if unpriced else [],
    )


def not_priced(count: int) -> str:
    return f"{count} line{'' if count == 1 else 's'} not priced"


def _line(index: int, line: InvoiceLine, currency: str | None, sheet: PriceSheet) -> LineResult:
    found = sheet.lookup(line.part_number)
    same_currency = found is not None and _same_currency(currency, found.currency)
    agreed, difference = _prices(line, found, same_currency)

    def result(status: str, reason: str, overcharge: str | None = None) -> LineResult:
        return LineResult(
            line_index=index,
            status=status,
            reason=reason,
            invoice_price=line.unit_price,
            agreed_price=agreed,
            difference=difference,
            overcharge=overcharge,
        )

    missing = _missing_number(line)
    if missing:
        return result("needs_person", f"{missing} is missing")
    quantity, price = Decimal(line.quantity), Decimal(line.unit_price)
    if quantity <= 0:
        return result("needs_person", "Quantity is zero or negative")
    if abs(quantity * price - Decimal(line.line_total)) >= ALLOWANCE:
        return result("needs_person", "Quantity times price does not equal line total")
    if line.part_number is None or not line.part_number.strip():
        return result("unknown_part", "No part number on this line")
    if found is None:
        return result("unknown_part", "Part is not on the price sheet")
    if sheet.has_conflict(line.part_number):
        return result("needs_person", "Price sheet lists more than one price for this part")
    if currency is None or not currency.strip():
        return result("needs_person", "Invoice currency is missing")
    if not same_currency:
        return result("needs_person", "currency differs")
    gap = price - found.unit_price
    if abs(gap * quantity) >= ALLOWANCE:
        return result(
            "price_mismatch",
            "Billed unit price differs from agreed price",
            money(max(gap, Decimal(0)) * quantity),
        )
    return result("match", "Agreed unit price", "0.00")


def _prices(
    line: InvoiceLine, found: SheetPrice | None, same_currency: bool
) -> tuple[str | None, str | None]:
    """The sheet's price and the gap per unit. No gap is given across two currencies."""
    if found is None:
        return None, None
    if line.unit_price is None or not same_currency:
        return found.unit_price_text, None
    gap = Decimal(line.unit_price) - found.unit_price
    # An equal price is shown as the invoice prints it, so 0.420 is not restated as 0.42.
    agreed = line.unit_price if gap == 0 else found.unit_price_text
    return agreed, plain(gap)


def _missing_number(line: InvoiceLine) -> str | None:
    if line.quantity is None:
        return "Quantity"
    if line.unit_price is None:
        return "Unit price"
    if line.line_total is None:
        return "Line total"
    return None


def _same_currency(invoice_currency: str | None, sheet_currency: str) -> bool:
    if invoice_currency is None:
        return False
    return invoice_currency.strip().casefold() == sheet_currency.strip().casefold()


def _invoice_sums_disagree(invoice: InvoiceRecord) -> bool:
    """Compare only what the invoice prints. A tax line that is not printed counts as no tax."""
    if invoice.invoice_total is None:
        return True
    total = Decimal(invoice.invoice_total)
    tax = Decimal(invoice.tax) if invoice.tax is not None else Decimal(0)
    printed = [Decimal(line.line_total) for line in invoice.lines if line.line_total is not None]
    every_line_printed = len(printed) == len(invoice.lines)
    lines_sum = sum(printed, Decimal(0))
    if invoice.subtotal is not None:
        subtotal = Decimal(invoice.subtotal)
        if every_line_printed and abs(lines_sum - subtotal) >= ALLOWANCE:
            return True
        return abs(subtotal + tax - total) >= ALLOWANCE
    if not every_line_printed:
        return False
    return abs(lines_sum + tax - total) >= ALLOWANCE
