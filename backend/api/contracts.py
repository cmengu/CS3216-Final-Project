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


class InvoiceSummary(Contract):
    id: str
    filename: str
    document_hash: str
    status: Literal["reading", "extracting", "checking", "completed", "failed"]
    mode: str
    created_at: str
    updated_at: str
    error: str | None
    price_sheet_version: str


class SavedInvoice(InvoiceSummary):
    document: ParsedDocument | None
    invoice: CheckingInvoice | InvoiceRecord | None
    check: CheckResult | None
    file_url: str
