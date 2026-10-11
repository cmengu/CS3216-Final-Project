import csv
import io
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from test_api import DATA, lightweight_reader
from test_extract import FakeClient, completed

from api.app import create_app
from api.csv_live import LiveStages, PriceSheet
from extract.context import CheckingInvoice
from read.bounded import read_pdf_bounded

MASTER = """key,supplier,po,item,description,uom,currency,unit_price,discount,tax,valid_from,valid_to
A,Supplier,PO-1,PART,Part,PC,SGD,10,0.05,0.09,2026-10-01,2026-10-31
B,Supplier,PO-1,FEE,Freight,JOB,SGD,20,0,0.09,2026-10-01,2026-10-31
"""


@pytest.fixture
def sheet(tmp_path):
    path = tmp_path / "prices.csv"
    path.write_text(MASTER)
    return path


def invoice(**line_changes):
    line = dict(
        part_number="PART",
        description="Part",
        quantity="2",
        unit_price="12",
        line_total="22.80",
        unit="PC",
        currency="SGD",
        exchange_rate=None,
        discount_rate="0.05",
        flat_charge=False,
    )
    line.update(line_changes)
    return CheckingInvoice(
        supplier_name="Supplier",
        purchase_order="PO-1",
        invoice_number="INV-1",
        invoice_date="2026-10-05",
        currency="SGD",
        subtotal="22.80",
        tax="2.05",
        invoice_total="24.85",
        tax_rate="0.09",
        warnings=[],
        lines=[line],
    )


def test_discount_overcharge_and_undercharge(sheet):
    check = PriceSheet(sheet).check(invoice())
    assert check.lines[0].status == "price_mismatch"
    assert check.overcharge_total == "3.80"
    lower = invoice(unit_price="8", line_total="15.20")
    lower.subtotal, lower.tax, lower.invoice_total = "15.20", "1.37", "16.57"
    check = PriceSheet(sheet).check(lower)
    assert check.lines[0].status == "price_mismatch"
    assert check.overcharge_total == "0.00"


def test_printed_discount_amount_without_percentage(sheet):
    record = invoice(discount_rate=None, discount_amount="1.20")
    assert PriceSheet(sheet).check(record).overcharge_total == "3.80"
    record.lines[0].discount_amount = "0.20"
    assert PriceSheet(sheet).check(record).lines[0].status == "needs_person"


def test_zero_discount_agreement_still_requires_reconciled_amount(sheet):
    sheet.write_text(MASTER.replace("10,0.05", "10,0"))
    record = invoice(discount_rate=None, line_total="24.00", part_number="PA RT")
    assert PriceSheet(sheet).check(record).lines[0].overcharge == "4.00"
    record.lines[0].line_total = "22.80"
    assert PriceSheet(sheet).check(record).lines[0].status == "needs_person"


@pytest.mark.parametrize(
    "field,value",
    [
        ("supplier_name", "Other"),
        ("purchase_order", "PO-2"),
        ("currency", "USD"),
        ("invoice_date", "2027-01-01"),
        ("invoice_date", "bad-date"),
        ("purchase_order", None),
    ],
)
def test_never_crosses_agreement_scope(sheet, field, value):
    record = invoice()
    setattr(record, field, value)
    check = PriceSheet(sheet).check(record)
    assert check.lines[0].status == "needs_person"
    assert check.overcharge_total is None


@pytest.mark.parametrize(
    "change",
    [
        {"unit": "BOX"},
        {"currency": "USD"},
        {"discount_rate": None},
        {"discount_rate": "0"},
        {"quantity": None},
        {"quantity": "-1"},
        {"line_total": "30"},
        {"unit_price": None},
    ],
)
def test_missing_context_and_arithmetic_are_not_matches(sheet, change):
    result = PriceSheet(sheet).check(invoice(**change))
    assert result.lines[0].status == "needs_person"
    assert result.overcharge_total is None


def test_fx_and_flat_fee(sheet):
    result = PriceSheet(sheet).check(invoice(currency="USD", unit_price="6", exchange_rate="2"))
    assert result.lines[0].invoice_price == "12"
    assert result.lines[0].overcharge == "3.80"
    flat = invoice(
        part_number=None,
        description="Freight",
        unit=None,
        quantity=None,
        unit_price=None,
        line_total="20",
        discount_rate="0",
        flat_charge=True,
        currency="CNY",
        exchange_rate="0.18",
    )
    assert PriceSheet(sheet).check(flat).lines[0].status == "match"


def test_equal_fx_price_serializes_zero_without_scientific_notation(sheet):
    record = invoice(currency="USD", unit_price="5", exchange_rate="2.000000", line_total="19.00")
    result = PriceSheet(sheet).check(record)
    assert result.lines[0].status == "match"
    assert result.lines[0].difference == "0.000000"


def test_unknown_item_and_duplicate_agreement(sheet):
    assert PriceSheet(sheet).check(invoice(part_number="OTHER")).lines[0].status == "unknown_part"
    sheet.write_text(MASTER + MASTER.splitlines()[1].replace("A,", "C,", 1) + "\n")
    assert PriceSheet(sheet).check(invoice()).lines[0].status == "needs_person"


def test_tolerance_and_warnings(sheet):
    record = invoice(unit_price="10.005", line_total="19.01")
    assert PriceSheet(sheet).check(record).lines[0].status == "match"
    record.warnings.append("Uncertain OCR row")
    assert PriceSheet(sheet).check(record).overcharge_total is None


def test_live_api_persists_extended_fields_without_fixture_lookup(sheet, tmp_path):
    client = FakeClient(completed(invoice()))
    stages = LiveStages(sheet, model="test-model", client=client)
    app = create_app(storage_dir=tmp_path / "store", stages=stages, reader=lightweight_reader)
    with TestClient(app) as http:
        response = http.post(
            "/invoices", files={"file": ("new.pdf", (DATA / "invoice-01.pdf").read_bytes())}
        )
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["mode"] == "live"
        assert saved["invoice"]["purchase_order"] == "PO-1"
        assert saved["invoice"]["lines"][0]["discount_rate"] == "0.05"
        assert saved["check"]["overcharge_total"] == "3.80"
        assert http.get(f"/invoices/{saved['id']}").json() == saved
    call = client.calls[0]
    assert call["text_format"] is CheckingInvoice
    assert "temperature" not in call
    assert "price-sheet" not in call["input"][1]["content"]


def test_live_startup_configuration(sheet, tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_MODE", "live")
    monkeypatch.setenv("INVOICE_CHECKER", "csv_context")
    monkeypatch.setenv("INVOICE_PRICE_SHEET", str(sheet))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        with TestClient(create_app(storage_dir=tmp_path)):
            pass
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-not-a-real-key")
    monkeypatch.setenv("INVOICE_PRICE_SHEET", str(sheet))
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    with TestClient(create_app(storage_dir=tmp_path)) as http:
        assert http.get("/health").json()["mode"] == "live"


def test_ocr_timeout_is_bounded(monkeypatch):
    monkeypatch.setenv("INVOICE_OCR_TIMEOUT", "0.001")
    with pytest.raises(TimeoutError, match="worker terminated"):
        read_pdf_bounded(DATA / "invoice-01.pdf")


def test_worker_failure_does_not_leak_document_text(monkeypatch):
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stderr="SECRET")
    )
    with pytest.raises(ValueError, match="OCR worker failed") as error:
        read_pdf_bounded(DATA / "invoice-01.pdf")
    assert "SECRET" not in str(error.value)


def test_checker_against_mock_answer_fields():
    """Checker-only test. Gold fields are NOT evidence of OCR/model accuracy."""
    dataset = DATA.parent / "mock_invoice_dataset"
    if not (dataset / "master_prices.csv").exists():
        pytest.skip("Optional local mock dataset not installed")

    def rows(name):
        return list(csv.DictReader(io.StringIO((dataset / name).read_text(encoding="utf-8-sig"))))

    sheet = PriceSheet(dataset / "master_prices.csv")
    gold_lines = rows("answer_key/expected_invoice_lines.csv")
    statuses = []
    for header in rows("answer_key/expected_invoice_totals.csv"):
        lines = [r for r in gold_lines if r["invoice"] == header["id"]]
        record = CheckingInvoice(
            supplier_name=header["supplier"],
            purchase_order=header["po"],
            invoice_number=header["id"],
            invoice_date=header["date"],
            currency=header["currency"],
            subtotal=header["subtotal"],
            tax=header["tax"],
            invoice_total=header["total"],
            tax_rate=header["tax_rate"],
            warnings=[],
            lines=[
                dict(
                    part_number=r["item"],
                    description=r["description"],
                    quantity=r["qty"],
                    unit_price=r["unit_price"],
                    line_total=r["amount"],
                    unit=r["uom"],
                    currency=r["currency"],
                    exchange_rate=None,
                    discount_rate=r["discount_rate"],
                    flat_charge=False,
                )
                for r in lines
            ],
        )
        result = sheet.check(record)
        assert result.warnings == []
        for expected, actual in zip(lines, result.lines):
            assert actual.status == ("match" if expected["flag"] == "PASS" else "price_mismatch")
            statuses.append(actual.status)
    assert statuses.count("match") == 51
    assert statuses.count("price_mismatch") == 7
