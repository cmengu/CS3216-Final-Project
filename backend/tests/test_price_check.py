import json
from decimal import Decimal
from pathlib import Path

import pytest

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


@pytest.mark.parametrize(
    "field, reason",
    [
        ("quantity", "Quantity is missing"),
        ("unit_price", "Unit price is missing"),
        ("line_total", "Line total is missing"),
    ],
)
def test_a_missing_number_names_the_field(field, reason):
    line = check(_record([_line(**{field: None})]), SHEET).lines[0]
    assert line.status == "needs_person"
    assert line.reason == reason
    assert line.overcharge is None


def test_a_line_with_no_part_number_is_an_unknown_part():
    record = _record([_line(part_number=None, description="Freight")])
    line = check(record, SHEET).lines[0]
    assert line.status == "unknown_part"
    assert line.reason == "No part number on this line"
    assert line.agreed_price is None


def test_the_total_is_the_known_overcharge_and_unpriced_lines_are_counted():
    record = _record(
        [
            _line(unit_price="0.015", line_total="0.15"),
            _line(part_number="NOT-ON-THE-SHEET"),
        ]
    )
    result = check(record, SHEET)
    assert [line.status for line in result.lines] == ["price_mismatch", "unknown_part"]
    assert result.overcharge_total == "0.03"
    assert result.warnings == ["1 line not priced"]


def test_a_price_below_the_sheet_is_a_mismatch_that_claims_nothing():
    result = check(_record([_line(quantity="1000", unit_price="0.010", line_total="10.00")]), SHEET)
    assert result.lines[0].status == "price_mismatch"
    assert result.lines[0].difference == "-0.002"
    assert result.overcharge_total == "0.00"
    assert result.warnings == []


def test_a_quantity_below_zero_goes_to_a_person_and_never_lowers_the_total():
    record = _record([_line(quantity="-5", unit_price="0.015", line_total="-0.08")])
    result = check(record, SHEET)
    assert result.lines[0].status == "needs_person"
    assert result.lines[0].reason == "Quantity is zero or negative"
    assert result.overcharge_total == "0.00"


def test_an_invoice_that_prints_no_subtotal_or_tax_is_checked_on_its_total():
    record = _record([_line()], subtotal=None, tax=None)
    result = check(record, SHEET)
    assert result.lines[0].status == "match"
    assert result.warnings == []


def test_lines_that_do_not_add_up_to_the_only_printed_total_stop_the_invoice():
    record = _record([_line()], subtotal=None, tax=None, invoice_total="9.99")
    result = check(record, SHEET)
    assert result.lines[0].status == "needs_person"
    assert result.warnings == ["Invoice arithmetic does not reconcile"]
    assert result.overcharge_total is None


def test_an_invoice_with_no_total_is_stopped():
    result = check(_record([_line()], invoice_total=None), SHEET)
    assert result.warnings == ["Invoice arithmetic does not reconcile"]


def test_subtotal_plus_tax_is_still_checked_when_a_line_total_is_missing():
    record = _record([_line(), _line(line_total=None)], subtotal="100.00", invoice_total="999.00")
    result = check(record, SHEET)
    assert result.warnings == ["Invoice arithmetic does not reconcile"]
    assert {line.status for line in result.lines} == {"needs_person"}


def test_a_missing_currency_is_named_and_not_called_a_difference():
    line = check(_record([_line()], currency=None), SHEET).lines[0]
    assert line.status == "needs_person"
    assert line.reason == "Invoice currency is missing"


def test_a_part_the_sheet_prices_twice_goes_to_a_person():
    price = SheetPrice("RES-0603-10K", "Resistor", "SGD", Decimal("0.012"), "0.012")
    sheet = PriceSheet(
        version="sheet", prices={"res-0603-10k": price}, conflicts=frozenset({"res-0603-10k"})
    )
    line = check(_record([_line()]), sheet).lines[0]
    assert line.status == "needs_person"
    assert line.reason == "Price sheet lists more than one price for this part"
    assert line.overcharge is None


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
    assert line.difference is None
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


def _record(lines, currency="SGD", **totals):
    subtotal = sum(
        (Decimal(line["line_total"]) for line in lines if line["line_total"] is not None),
        Decimal(0),
    )
    record = {
        "supplier_name": "Demo Circuit Supplies",
        "invoice_number": "DEMO-X",
        "invoice_date": "2026-10-01",
        "currency": currency,
        "subtotal": str(subtotal.quantize(Decimal("0.01"))),
        "tax": "0.00",
        "invoice_total": str(subtotal.quantize(Decimal("0.01"))),
        "lines": lines,
    }
    record.update(totals)
    return InvoiceRecord.model_validate(record)
