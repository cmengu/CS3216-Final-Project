import json
from decimal import Decimal
from pathlib import Path

from check import PriceSheet, SheetPrice, check, load_price_sheet
from schema import InvoiceRecord

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


def test_a_fraction_of_a_cent_on_a_short_line_is_a_match():
    line = _checked(quantity="10", unit_price="0.013", line_total="0.13")
    assert line.status == "match"
    assert line.difference == "0.0005"
    assert line.overcharge == "0.00"
    assert abs(Decimal(line.difference) * Decimal("10")) == Decimal("0.005")


def test_the_same_gap_on_a_long_line_is_still_a_mismatch():
    line = _checked(quantity="100000", unit_price="0.013", line_total="1300.00")
    assert line.status == "price_mismatch"
    assert line.overcharge == "50.00"
    assert line.difference == "0.0005"


def test_a_line_total_within_one_cent_is_not_sent_to_a_person():
    line = _checked(quantity="10", unit_price="0.012", line_total="0.125")
    assert line.status == "match"


def test_dummy_invoice_02_is_still_fifteen_dollars_over():
    manifest = json.loads((DATA / "manifest.json").read_text())
    case = next(item for item in manifest["cases"] if item["id"] == "invoice-02")
    sheet = load_price_sheet(DATA / "price-sheet.xlsx")
    result = check(InvoiceRecord.model_validate(case["invoice"]), sheet)
    assert result.lines[0].status == "price_mismatch"
    assert result.overcharge_total == "15.00"


def _checked(**line):
    sheet = PriceSheet(
        version="sheet",
        prices={
            "res-0603-10k": SheetPrice(
                part_number="RES-0603-10K",
                description="Resistor",
                currency="SGD",
                unit_price=Decimal("0.0125") if line["unit_price"] == "0.013" else Decimal("0.012"),
                unit_price_text="0.0125" if line["unit_price"] == "0.013" else "0.012",
            )
        },
    )
    total = Decimal(line["line_total"])
    record = InvoiceRecord.model_validate(
        {
            "supplier_name": "Demo Circuit Supplies",
            "invoice_number": "DEMO-R",
            "invoice_date": "2026-10-01",
            "currency": "SGD",
            "subtotal": str(total.quantize(Decimal("0.01"))),
            "tax": "0.00",
            "invoice_total": str(total.quantize(Decimal("0.01"))),
            "lines": [
                {
                    "part_number": "RES-0603-10K",
                    "description": "Resistor",
                    "quantity": line["quantity"],
                    "unit_price": line["unit_price"],
                    "line_total": line["line_total"],
                }
            ],
        }
    )
    return check(record, sheet).lines[0]
