import json

import pytest
from fastapi.testclient import TestClient
from test_api import DATA, lightweight_reader
from test_live import invoice

from api.app import create_app
from api.csv_live import LiveStages
from api.uploaded_master import UploadedPriceSheet


def sheet(**changes):
    return UploadedPriceSheet(
        {
            "version": "uploaded-v1",
            "items": [{"name": "PART", "price": "10", "quantity": None, **changes}],
        }
    )


def test_minimal_uploaded_fields_and_price_comparison():
    result = sheet().check(invoice())
    assert result.price_sheet_version == "uploaded-v1"
    assert result.lines[0].status == "price_mismatch"
    assert result.overcharge_total == "3.80"
    assert sheet(price="12").check(invoice()).lines[0].status == "match"
    assert sheet(name="OTHER").check(invoice()).lines[0].status == "unknown_part"


def test_quantity_and_optional_constraints():
    assert sheet(quantity="2").check(invoice()).lines[0].status == "price_mismatch"
    for options in (
        {"quantity": "3"},
        {"supplier": "Other"},
        {"currency": "USD"},
        {"po": "Other"},
        {"unit": "KG"},
        {"validTo": "2025-01-01"},
    ):
        assert sheet(**options).check(invoice()).lines[0].status == "needs_person"


def test_ambiguous_names_do_not_choose_a_price():
    s = sheet()
    s.items.append({"name": "PART", "price": "11"})
    assert s.check(invoice()).lines[0].status == "needs_person"


def test_description_and_flat_price():
    assert (
        sheet(name="Part", item=None).check(invoice(part_number=None)).lines[0].status
        == "price_mismatch"
    )
    r = invoice(
        part_number=None,
        description="Freight",
        unit_price=None,
        quantity=None,
        line_total="10",
        flat_charge=True,
        discount_rate=None,
    )
    assert sheet(name="Freight").check(r).lines[0].status == "match"


def test_api_reads_latest_upload_and_pins_version_during_extraction(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_MODE", "live")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    monkeypatch.setenv("INVOICE_PRICE_SHEET", "/does/not/exist.csv")
    options = json.dumps({"sheet": "CSV", "header": 0, "mapping": {"name": 0, "price": 1}})
    app = create_app(storage_dir=tmp_path, reader=lightweight_reader)
    with TestClient(app) as client:

        def upload_master(price, method="post"):
            return getattr(client, method)(
                "/master-list",
                files={"file": ("prices.csv", f"name,price\nPART,{price}\n")},
                data={"options": options},
            )

        first = upload_master(10)
        assert first.status_code == 201, first.text
        original_version = first.json()["version"]

        def extract(self, document):
            assert upload_master(12, "put").status_code == 200
            return invoice()

        monkeypatch.setattr(LiveStages, "extract", extract)
        data = (DATA / "invoice-02.pdf").read_bytes()
        saved = client.post("/invoices", files={"file": ("invoice.pdf", data)})
        assert saved.status_code == 201, saved.text
        assert saved.json()["price_sheet_version"] == original_version
        assert saved.json()["check"]["lines"][0]["status"] == "price_mismatch"
        second = client.post("/invoices", files={"file": ("invoice.pdf", data)})
        assert second.status_code == 201
        assert second.json()["check"]["lines"][0]["status"] == "match"
        assert second.json()["price_sheet_version"] != original_version
        with app.state.store.connect() as db:
            db.execute("DELETE FROM master_lists")
        rejected = client.post("/invoices", files={"file": ("invoice.pdf", data)})
        assert rejected.status_code == 409
        assert len(client.get("/invoices").json()) == 2
        assert (
            client.get(f"/invoices/{saved.json()['id']}").json()["price_sheet_version"]
            == original_version
        )




@pytest.mark.parametrize(
    "changes",
    [
        {"quantity": None},
        {"quantity": "0"},
        {"unit_price": None},
        {"unit_price": "-1"},
        {"line_total": None},
        {"line_total": "999"},
        {"discount_rate": "1.1"},
        {"discount_amount": "100"},
        {"exchange_rate": "2"},
        {"currency": "USD", "exchange_rate": None},
    ],
)
def test_incomplete_or_inconsistent_invoice_requires_review(changes):
    assert sheet().check(invoice(**changes)).lines[0].status == "needs_person"


def test_conversion_keeps_comparison_in_unit_currency_and_overcharge_in_invoice_currency():
    record = invoice(currency="USD", exchange_rate="1.3", line_total="29.64")
    result = sheet(currency="USD").check(record).lines[0]
    assert result.status == "price_mismatch"
    assert result.agreed_price == "10"
    assert result.difference == "2"
    assert result.overcharge == "4.94"


def test_fixed_discount_and_undercharge():
    result = sheet().check(invoice(discount_rate=None, discount_amount="1.20")).lines[0]
    assert result.overcharge == "4.00"
    result = sheet().check(invoice(unit_price="8", line_total="15.20")).lines[0]
    assert result.status == "price_mismatch"
    assert result.overcharge == "0.00"


def test_price_tolerance_boundary():
    assert sheet(price="11.995").check(invoice()).lines[0].status == "match"
    assert sheet(price="11.994").check(invoice()).lines[0].status == "price_mismatch"


def test_dates_are_inclusive_and_missing_date_cannot_match_dated_price():
    s = sheet(validFrom="2026-10-05", validTo="2026-10-05")
    assert s.check(invoice()).lines[0].status == "price_mismatch"
    record = invoice()
    record.invoice_date = None
    assert s.check(record).lines[0].status == "needs_person"


def test_missing_printed_discount_cannot_be_invented_from_master():
    result = sheet(discount=0.05).check(invoice(discount_rate=None, discount_amount=None))
    assert result.lines[0].status == "needs_person"


def test_optional_scope_disambiguates_duplicate_names():
    s = sheet(supplier="Supplier")
    s.items.append({"name": "PART", "price": "12", "supplier": "Other"})
    assert s.check(invoice()).lines[0].agreed_price == "10"


def test_invoice_total_mismatch_prevents_complete_check():
    record = invoice()
    record.invoice_total = "999"
    result = sheet().check(record)
    assert result.overcharge_total is None
    assert result.warnings
