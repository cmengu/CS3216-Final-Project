"""Versioned import -> live extraction -> checks; no paid model or OCR calls."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from test_api import DATA, lightweight_reader
from test_extract import FakeClient, completed
from test_live import invoice

from api.app import create_app
from api.csv_live import LiveStages, PriceSheet
from api.uploaded_master import UploadedMasterStages

OPTIONS = {
    "sheet": "CSV",
    "header": 0,
    "mapping": {
        "name": 0,
        "price": 1,
        "currency": 2,
        "unit": 3,
        "item": 4,
        "supplier": 5,
        "po": 6,
        "discount": 7,
        "tax": 8,
    },
}


def import_csv(client, price="10", method="post"):
    data = (
        "Description,Rate,CCY,UOM,Code,Vendor,Order,Discount,GST\n"
        f"Part,{price},SGD,PC,PART,Supplier,PO-1,5%,9%\n"
    ).encode()
    return getattr(client, method)(
        "/master-list",
        files={"file": ("prices.csv", data)},
        data={"options": json.dumps(OPTIONS)},
    )


def upload(client):
    return client.post(
        "/invoices", files={"file": ("test.pdf", (DATA / "invoice-01.pdf").read_bytes())}
    )


def test_replacement_changes_new_checks_and_preserves_old_versions(tmp_path):
    model = FakeClient(completed(invoice()))
    stages = UploadedMasterStages(model="test-model", client=model)
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        assert client.get("/health").json()["processing_configured"] is False
        assert upload(client).status_code == 503
        first = import_csv(client)
        assert first.status_code == 201, first.text
        old_version = first.json()["version"]
        original = upload(client)
        assert original.status_code == 201, original.text
        original = original.json()
        assert original["check"]["lines"][0]["status"] == "price_mismatch"
        assert original["check"]["overcharge_total"] == "3.80"
        assert original["price_sheet_version"] == old_version

        book = Workbook()
        sheet = book.active
        sheet.title = "Catalogue"
        sheet.append(["New supplier catalogue"])
        sheet.append(["CCY", "Agreed", "Material", "Measure", "Code", "Discount", "Tax"])
        sheet.append(["SGD", 12, "Part", "PC", "PART", "5%", "9%"])
        data = io.BytesIO()
        book.save(data)
        options = {
            "sheet": "Catalogue",
            "header": 1,
            "mapping": {
                "currency": 0,
                "price": 1,
                "name": 2,
                "unit": 3,
                "item": 4,
                "discount": 5,
                "tax": 6,
            },
        }
        replaced = client.put(
            "/master-list",
            files={"file": ("catalogue.xlsx", data.getvalue())},
            data={"options": json.dumps(options)},
        )
        assert replaced.status_code == 200, replaced.text
        new_version = replaced.json()["version"]
        assert new_version != old_version
        updated = upload(client)
        assert updated.status_code == 201, updated.text
        updated = updated.json()
        assert updated["price_sheet_version"] == new_version
        assert updated["check"]["lines"][0]["status"] == "match"
        assert updated["check"]["overcharge_total"] == "0.00"
        assert client.get(f"/invoices/{original['id']}").json() == original
        snapshot = client.get(f"/master-list/versions/{old_version}")
        assert snapshot.json()["items"][0]["price"] == "10"
        assert snapshot.headers["cache-control"] == "no-store"
        assert client.get("/master-list/versions/missing").status_code == 404
        assert len(model.calls) == 2

    with TestClient(create_app(storage_dir=tmp_path, stages=stages)) as restarted:
        assert restarted.get(f"/invoices/{original['id']}").json() == original
        assert restarted.get(f"/master-list/versions/{old_version}").status_code == 200


def test_snapshot_is_selected_before_reading_even_if_master_changes_mid_upload(tmp_path):
    stages = UploadedMasterStages(model="test-model", client=FakeClient(completed(invoice())))

    def reader(path, **kwargs):
        response = import_csv(client, price="12", method="put")
        assert response.status_code == 200
        return lightweight_reader(path, **kwargs)

    with TestClient(create_app(storage_dir=tmp_path, stages=stages, reader=reader)) as client:
        first = import_csv(client).json()
        response = upload(client)
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["price_sheet_version"] == first["version"]
        assert saved["check"]["lines"][0]["agreed_price"] == "10"
        assert client.get("/master-list").json()["version"] != first["version"]


@pytest.mark.parametrize("missing", ["currency", "unit"])
def test_missing_agreement_fields_never_become_matches(missing):
    item = {"name": "Part", "price": "12", "currency": "SGD", "unit": "PC"}
    item[missing] = None
    result = PriceSheet.from_master({"version": "test", "items": [item]}).check(invoice())
    assert result.lines[0].status == "needs_person"
    assert result.overcharge_total is None


def test_unscoped_unique_items_work_but_ambiguous_items_need_review():
    item = {"name": "Part", "price": "12", "currency": "SGD", "unit": "PC"}
    result = PriceSheet.from_master({"version": "test", "items": [item]}).check(invoice())
    assert result.lines[0].status == "match"
    result = PriceSheet.from_master(
        {"version": "test", "items": [item, {**item, "price": "99"}]}
    ).check(invoice())
    assert result.lines[0].status == "needs_person"


def test_extraction_supports_master_without_codes_or_supplier_scope():
    item = {"name": "Part", "price": "12", "currency": "SGD", "unit": "PC"}
    sheet = PriceSheet.from_master({"version": "test", "items": [item]})
    client = FakeClient(completed(invoice()))
    stages = LiveStages(sheet, model="test-model", client=client)
    record = stages.extract(lightweight_reader(DATA / "invoice-01.pdf"))
    assert len(client.calls) == 1
    assert stages.check(record).lines[0].status == "match"


def test_numeric_skus_are_matched_as_codes_not_row_numbers():
    item = {
        "name": "Catalogue wording",
        "item": "12345",
        "price": "12",
        "currency": "SGD",
        "unit": "PC",
    }
    record = invoice(part_number="12345", description="Printed wording")
    sheet = PriceSheet.from_master({"version": "test", "items": [item]})
    assert sheet.check(record).lines[0].status == "match"


@pytest.mark.parametrize("mode", ["master_list", "csv_context"])
def test_live_uploaded_mode_does_not_require_csv_configuration(tmp_path, monkeypatch, mode):
    monkeypatch.setenv("INVOICE_MODE", "live")
    monkeypatch.setenv("INVOICE_CHECKER", mode)
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-not-a-real-key")
    monkeypatch.delenv("INVOICE_PRICE_SHEET", raising=False)
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert client.get("/health").json()["processing_configured"] is False
        assert import_csv(client).status_code == 201
        assert client.get("/health").json()["processing_configured"] is True


def test_normalized_units_do_not_require_dataset_specific_spellings():
    item = {"name": "Part", "price": "12", "currency": "SGD", "unit": "m³"}
    record = invoice(unit="M3")
    assert (
        PriceSheet.from_master({"version": "test", "items": [item]}).check(record).lines[0].status
        == "match"
    )
    fee = {"name": "Freight", "price": "20", "currency": "SGD", "unit": "job"}
    record = invoice(
        part_number=None,
        description="Freight",
        unit=None,
        quantity=None,
        unit_price=None,
        line_total="20",
        discount_rate=None,
        flat_charge=True,
    )
    assert (
        PriceSheet.from_master({"version": "test", "items": [fee]}).check(record).lines[0].status
        == "match"
    )


def test_printed_discount_amount_without_agreed_rate_is_reconciled():
    item = {"name": "Part", "price": "10", "currency": "SGD", "unit": "PC"}
    record = invoice(discount_rate=None, discount_amount="1.20")
    result = PriceSheet.from_master({"version": "test", "items": [item]}).check(record)
    assert result.lines[0].status == "price_mismatch"
    assert result.overcharge_total == "4.00"
