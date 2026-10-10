"""PROPOSED build-plan handoff. Chen Meng/team own approval and subsequent changes.

Decimal strings preserve semiconductor unit prices. Nullable fields preserve unreadable
values. Reader provenance and service metadata remain separate from invoice fields.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

DecimalText = Annotated[str, Field(pattern=r"^-?\d+(?:\.\d+)?$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvoiceLine(Contract):
    part_number: str | None
    description: str | None
    quantity: DecimalText | None
    unit_price: DecimalText | None
    line_total: DecimalText | None


class InvoiceRecord(Contract):
    supplier_name: str | None
    invoice_number: str | None
    invoice_date: str | None
    currency: str | None
    subtotal: DecimalText | None
    tax: DecimalText | None
    invoice_total: DecimalText | None
    lines: list[InvoiceLine]
