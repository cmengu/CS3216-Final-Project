"""Proposed service/check handoffs; the checking implementation belongs to Kalent."""

from typing import Literal

from pydantic import Field

from extract.context import CheckingInvoice
from read.models import ParsedDocument
from schema import Contract, DecimalText, InvoiceRecord


class LineResult(Contract):
    line_index: int = Field(ge=0)
    status: Literal["match", "price_mismatch", "unknown_part", "needs_person"]
    reason: str
    invoice_price: DecimalText | None
    agreed_price: DecimalText | None
    difference: DecimalText | None
    overcharge: DecimalText | None


class CheckResult(Contract):
    price_sheet_version: str
    lines: list[LineResult]
    overcharge_total: DecimalText | None
    warnings: list[str]


Outcome = Literal["ready_to_pay", "ready_to_pay_anyway", "raise_with_supplier"]


class OutcomeRequest(Contract):
    """The AP clerk's decision on a finished invoice. A null outcome clears it."""

    outcome: Outcome | None
    reason: str | None = Field(default=None, max_length=500)


class InvoiceSummary(Contract):
    id: str
    filename: str
    document_hash: str
    status: Literal["queued", "reading", "extracting", "checking", "completed", "failed"]
    mode: str
    created_at: str
    updated_at: str
    error: str | None
    price_sheet_version: str
    outcome: Outcome | None = None
    outcome_reason: str | None = None
    decided_at: str | None = None


class SavedInvoice(InvoiceSummary):
    document: ParsedDocument | None
    invoice: CheckingInvoice | InvoiceRecord | None
    check: CheckResult | None
    file_url: str
