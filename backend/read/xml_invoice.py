"""Read Vietnamese HDon e-invoices without OCR, model calls or inferred values."""

import hashlib
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring

from extract.context import CheckingInvoice, CheckingLine
from read.models import ParsedDocument
from read.reader import MAX_BYTES


def _text(node, path):
    matches = node.findall(path)
    if len(matches) > 1:
        raise ValueError("XML contains duplicate invoice fields")
    if not matches:
        return None
    return (matches[0].text or "").strip() or None


def _decimal(node, path):
    value = _text(node, path)
    if value is None:
        return None
    # HDon numbers use a decimal point, with no thousands separators.
    if len(value) > 80 or not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        raise ValueError(f"XML field {path.rsplit('/', 1)[-1]} has an invalid decimal number")
    try:
        number = Decimal(value)
        if not number.is_finite():
            raise InvalidOperation
    except InvalidOperation as exc:
        raise ValueError("XML contains an invalid decimal number") from exc
    return value


def _rate(value):
    if value is None:
        return None
    raw = value.removesuffix("%")
    if not re.fullmatch(r"\d+(?:\.\d+)?", raw) or len(raw) > 20:
        return None
    number = Decimal(raw) / 100
    return format(number, "f") if 0 <= number <= 1 else None


def read_xml_invoice(data: bytes, filename: str) -> tuple[ParsedDocument, CheckingInvoice]:
    if not 0 < len(data) <= MAX_BYTES:
        raise ValueError("XML must be nonempty and at most 20 MiB")
    try:
        root = fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (DefusedXmlException, ParseError, ValueError) as exc:
        raise ValueError("XML is invalid or contains prohibited DTD/entity declarations") from exc
    # Namespace prefixes vary by issuer. Match the invoice vocabulary, never signature content.
    count = 0
    for node in root.iter():
        count += 1
        if count > 100_000:
            raise ValueError("XML contains too many elements")
        node.tag = node.tag.rsplit("}", 1)[-1]
    if root.tag != "HDon":
        raise ValueError(
            "Unsupported XML invoice format. Upload a Vietnamese HDon e-invoice or a PDF"
        )
    documents = root.findall("DLHDon")
    if len(documents) != 1:
        raise ValueError("XML must contain exactly one DLHDon invoice")
    invoice = documents[0]
    warnings = []
    issued = _text(invoice, "TTChung/NLap")
    if issued is not None:
        try:
            date.fromisoformat(issued)
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", issued):
                raise ValueError
        except ValueError:
            warnings.append("XML invoice date is invalid; human review required")
            issued = None
    currency = _text(invoice, "TTChung/DVTTe")
    if currency and not re.fullmatch(r"[A-Z]{3}", currency):
        warnings.append("XML invoice currency is invalid; human review required")
        currency = None
    lines = []
    tax_rates = set()
    rows = invoice.findall("NDHDon/DSHHDVu/HHDVu")
    if len(rows) > 5000:
        raise ValueError("XML contains more than 5,000 invoice lines")
    for row in rows:
        kind = _text(row, "TChat")
        if kind != "1":
            warnings.append(
                "XML contains a promotional, discount, note or unspecified line; human review required"
            )
        tax = _text(row, "TSuat")
        if tax:
            tax_rates.add(_rate(tax))
        discount = _text(row, "TLCKhau")
        discount_rate = _rate(discount)
        if discount is not None and discount_rate is None:
            warnings.append("XML contains an unsupported discount rate; human review required")
        lines.append(
            CheckingLine(
                part_number=_text(row, "MHHDVu"),
                description=_text(row, "THHDVu"),
                unit=_text(row, "DVTinh"),
                quantity=_decimal(row, "SLuong"),
                unit_price=_decimal(row, "DGia"),
                line_total=_decimal(row, "ThTien"),
                currency=currency,
                # TGia converts the invoice currency to VND for tax reporting, not the line price.
                exchange_rate=None,
                discount_rate=discount_rate,
                discount_amount=_decimal(row, "STCKhau"),
                flat_charge=False,
            )
        )
    for field, path in (
        ("supplier", "NDHDon/NBan/Ten"),
        ("invoice number", "TTChung/SHDon"),
        ("currency", "TTChung/DVTTe"),
    ):
        if not _text(invoice, path):
            warnings.append(f"XML invoice {field} is missing; human review required")
    if issued is None:
        warnings.append("XML invoice date is missing or invalid; human review required")
    totals = {
        "subtotal": _decimal(invoice, "NDHDon/TToan/TgTCThue"),
        "tax": _decimal(invoice, "NDHDon/TToan/TgTThue"),
        "invoice_total": _decimal(invoice, "NDHDon/TToan/TgTTTBSo"),
    }
    if any(value is None for value in totals.values()):
        warnings.append("XML invoice totals are incomplete; human review required")
    if not tax_rates:
        warnings.append("XML invoice tax rate is missing; human review required")
    if len(tax_rates) > 1 or None in tax_rates:
        warnings.append("XML has mixed or unsupported tax rates; human review required")
    total_discount = _decimal(invoice, "NDHDon/TToan/TTCKTMai")
    if total_discount is not None and Decimal(total_discount) != 0:
        warnings.append("XML has an invoice-level discount; human review required")
    record = CheckingInvoice(
        supplier_name=_text(invoice, "NDHDon/NBan/Ten"),
        invoice_number=_text(invoice, "TTChung/SHDon"),
        invoice_date=issued,
        currency=currency,
        purchase_order=None,
        tax_rate=next(iter(tax_rates)) if len(tax_rates) == 1 else None,
        lines=lines,
        warnings=list(dict.fromkeys(warnings)),
        **totals,
    )
    document = ParsedDocument(
        document_hash=hashlib.sha256(data).hexdigest(),
        filename=filename,
        page_count=0,
        reader_version="hdon-xml-1",
        markdown="Structured XML invoice; no OCR or model extraction was used.",
        blocks=[],
        docling_document={},
    )
    return document, record
