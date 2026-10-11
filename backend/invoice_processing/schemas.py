"""Versioned handoff contracts. Extracted values remain strings, never catalogue prices."""

from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from read.models import PageRead


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def decimal_value(value: Any) -> Decimal:
    if isinstance(value, (float, bool)):
        raise ValueError("Supply decimals as strings, not floating point numbers")
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("Expected a decimal string") from exc
    if (
        not result.is_finite()
        or result < 0
        or result > Decimal("1e12")
        or result.as_tuple().exponent < -6
    ):
        raise ValueError(
            "Expected a finite, non-negative decimal up to 1e12 and six decimal places"
        )
    return result


Amount = Annotated[Decimal, BeforeValidator(decimal_value)]


class Location(Model):
    page: int = Field(ge=1)
    # Docling coordinates are preserved, including their origin and page dimensions.
    bbox: dict[str, Any] | None = None
    page_width: float | None = None
    page_height: float | None = None


class SourceBlock(Model):
    id: str
    text: str
    locations: list[Location]


class ParsedDocument(Model):
    schema_version: Literal["1"] = "1"
    document_hash: str
    filename: str
    page_count: int
    reader_version: str
    markdown: str
    blocks: list[SourceBlock]
    pages: list[PageRead] = Field(default_factory=list)
    docling_document: dict[str, Any]


class Evidence(Model):
    block_id: str
    quote: str


class ExtractedField(Model):
    value: str | None
    evidence: list[Evidence]


class InvoiceLine(Model):
    description: ExtractedField
    sku: ExtractedField
    quantity: ExtractedField
    unit: ExtractedField
    unit_price: ExtractedField
    # Absolute line discount, not a percentage. Null when not explicitly printed.
    discount: ExtractedField
    line_total: ExtractedField


class Invoice(Model):
    document_type: Literal["invoice", "credit_note", "other"]
    invoice_number: ExtractedField
    supplier_name: ExtractedField
    supplier_id: ExtractedField
    buyer_name: ExtractedField
    invoice_date: ExtractedField
    currency: ExtractedField
    subtotal: ExtractedField
    tax_total: ExtractedField
    grand_total: ExtractedField
    lines: list[InvoiceLine]
    warnings: list[str]


class Extraction(Model):
    schema_version: Literal["1"] = "1"
    document_hash: str
    model: str
    prompt_version: str
    response_id: str | None = None
    invoice: Invoice
    # Grounding failures are explicit; they never become a successful comparison.
    grounding_issues: list[str] = Field(default_factory=list)


class MasterLine(Model):
    row_id: str = Field(min_length=1)
    sku: str = Field(min_length=1)
    quantity: Amount
    unit: str = Field(min_length=1)
    unit_price: Amount
    discount: Amount = Decimal("0")
    line_total: Amount


class MasterInvoice(Model):
    invoice_number: str = Field(min_length=1)
    supplier_id: str = Field(min_length=1)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    subtotal: Amount
    tax_total: Amount
    grand_total: Amount
    lines: list[MasterLine] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_rows(self):
        if len({line.row_id for line in self.lines}) != len(self.lines):
            raise ValueError("Master row IDs must be unique within an invoice")
        return self


class MasterSnapshot(Model):
    schema_version: Literal["1"] = "1"
    snapshot_id: str = Field(min_length=1)
    # v1 deliberately requires an invoice register, not just a product catalogue.
    kind: Literal["invoice_register"] = "invoice_register"
    invoices: list[MasterInvoice]


class Issue(Model):
    code: str
    field: str
    message: str
    invoice_value: str | None = None
    master_value: str | None = None
    master_row_id: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class Comparison(Model):
    schema_version: Literal["1"] = "1"
    rules_version: Literal["invoice-register-v1"] = "invoice-register-v1"
    document_hash: str
    master_snapshot_id: str
    master_snapshot_hash: str
    status: Literal["matched", "needs_review", "unable_to_verify"]
    issues: list[Issue]
