import json
from decimal import Decimal
from pathlib import Path

from api.contracts import CheckResult
from check import PriceSheet, SheetPrice, check, load_price_sheet
from schema import InvoiceRecord

DATA = Path(__file__).resolve().parents[2] / "data/dummy"
MANIFEST = json.loads((DATA / "manifest.json").read_text())
SHEET = load_price_sheet(DATA / "price-sheet.xlsx")


def test_each_dummy_invoice_matches_its_answer():
    for case in MANIFEST["cases"]:
        result = check(InvoiceRecord.model_validate(case["invoice"]), SHEET)
        assert result.price_sheet_version == MANIFEST["price_sheet_sha256"]
        body = result.model_dump()
        body.pop("price_sheet_version")
        assert body == case["expected_check"]


def test_empty_quantity_names_the_field():
    record = _record([_line(quantity=None, line_total=None)])
    line = check(record, SHEET).lines[0]
    assert line.status == "needs_person"
    assert line.reason == "Quantity is missing"


def test_different_currency_is_not_converted():
    sheet = PriceSheet(
        version="sheet",
        prices={
            "res-0603-10k": SheetPrice(
                part_number="RES-0603-10K",
                description="Resistor",
                currency="SGD",
                unit_price=Decimal("0.012"),
                unit_price_text="0.012",
            )
        },
    )
    record = _record([_line()], currency="USD")
    line = check(record, sheet).lines[0]
    assert line.status == "needs_person"
    assert line.reason == "currency differs"
    assert line.agreed_price == "0.012"
    assert isinstance(check(record, sheet), CheckResult)


def _line(**overrides):
    line = {
        "part_number": "RES-0603-10K",
        "description": "Resistor 10k ohm 0603",
        "quantity": "10",
        "unit_price": "0.012",
        "line_total": "0.12",
    }
    line.update(overrides)
    return line


def _record(lines, currency="SGD"):
    subtotal = sum(
        (Decimal(line["line_total"]) for line in lines if line["line_total"] is not None),
        Decimal(0),
    )
    return InvoiceRecord.model_validate(
        {
            "supplier_name": "Demo Circuit Supplies",
            "invoice_number": "DEMO-X",
            "invoice_date": "2026-10-01",
            "currency": currency,
            "subtotal": str(subtotal.quantize(Decimal("0.01"))),
            "tax": "0.00",
            "invoice_total": str(subtotal.quantize(Decimal("0.01"))),
            "lines": lines,
        }
    )
