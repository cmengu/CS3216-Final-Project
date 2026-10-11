"""Extra printed context for live checking; the original field-only handoff stays intact."""

from schema import DecimalText, InvoiceLine, InvoiceRecord


class CheckingLine(InvoiceLine):
    unit: str | None
    currency: str | None
    exchange_rate: DecimalText | None
    discount_rate: DecimalText | None
    discount_amount: DecimalText | None = None
    flat_charge: bool


class CheckingInvoice(InvoiceRecord):
    purchase_order: str | None
    tax_rate: DecimalText | None
    lines: list[CheckingLine]
    warnings: list[str]
