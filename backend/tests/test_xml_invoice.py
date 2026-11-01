"""Synthetic HDon examples only; never retain client invoice data in tests."""

import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.uploaded_master import UploadedMasterStages
from read.xml_invoice import read_xml_invoice

XML = b"""<?xml version="1.0" encoding="utf-8"?>
<HDon><DLHDon Id="synthetic"><TTChung><SHDon>DEMO-1</SHDon>
<NLap>2026-01-03</NLap><DVTTe>VND</DVTTe><TGia>1</TGia></TTChung>
<NDHDon><NBan><Ten>Invented Supplier</Ten></NBan><DSHHDVu><HHDVu>
<TChat>1</TChat><MHHDVu>DEMO-PART</MHHDVu><THHDVu>Demo part</THHDVu>
<DVTinh>PC</DVTinh><SLuong>2</SLuong><DGia>10.1250</DGia>
<ThTien>20.25</ThTien><TSuat>8%</TSuat></HHDVu></DSHHDVu>
<TToan><TgTCThue>20.25</TgTCThue><TgTThue>1.62</TgTThue>
<TgTTTBSo>21.87</TgTTTBSo></TToan></NDHDon></DLHDon></HDon>"""


def test_reads_exact_structured_fields_and_decimal_precision():
    document, invoice = read_xml_invoice(XML, "demo.xml")
    assert document.document_hash == hashlib.sha256(XML).hexdigest()
    assert document.page_count == 0
    assert invoice.supplier_name == "Invented Supplier"
    assert invoice.invoice_number == "DEMO-1"
    assert invoice.invoice_date == "2026-01-03"
    assert invoice.currency == "VND"
    assert invoice.tax_rate == "0.08"
    assert invoice.lines[0].unit_price == "10.1250"
    assert invoice.lines[0].exchange_rate is None
    assert invoice.warnings == []


def test_issuer_namespaces_and_repeated_line_items_are_preserved():
    data = XML.replace(b"<HDon>", b'<HDon xmlns="urn:synthetic:invoice">')
    row = data.split(b"<HHDVu>")[1].split(b"</HHDVu>")[0]
    data = data.replace(b"</DSHHDVu>", b"<HHDVu>" + row + b"</HHDVu></DSHHDVu>")
    _, invoice = read_xml_invoice(data, "namespaced.xml")
    assert len(invoice.lines) == 2
    assert invoice.lines[0] == invoice.lines[1]


@pytest.mark.parametrize(
    "data",
    [
        b"<HDon><broken>",
        b'<!DOCTYPE HDon [<!ENTITY x "value">]><HDon>&x;</HDon>',
        b'<!DOCTYPE HDon SYSTEM "file:///etc/passwd"><HDon/>',
    ],
)
def test_rejects_malformed_xml_and_entity_declarations(data):
    with pytest.raises(ValueError, match="invalid|prohibited"):
        read_xml_invoice(data, "bad.xml")


def test_rejects_unknown_formats_and_duplicate_documents():
    with pytest.raises(ValueError, match="Unsupported XML invoice format"):
        read_xml_invoice(b"<Invoice/>", "other.xml")
    with pytest.raises(ValueError, match="exactly one"):
        read_xml_invoice(b"<HDon><DLHDon/><DLHDon/></HDon>", "many.xml")
    with pytest.raises(ValueError, match="duplicate invoice fields"):
        read_xml_invoice(XML.replace(b"</SHDon>", b"</SHDon><SHDon>other</SHDon>"), "duplicate.xml")


def test_missing_values_stay_unknown_and_cannot_produce_a_clear_result():
    data = XML.replace(b"<DVTTe>VND</DVTTe>", b"").replace(b"<TgTThue>1.62</TgTThue>", b"")
    _, invoice = read_xml_invoice(data, "missing.xml")
    assert invoice.currency is None and invoice.tax is None
    assert invoice.lines[0].currency is None
    assert any("currency" in warning for warning in invoice.warnings)
    assert any("totals" in warning for warning in invoice.warnings)


def test_special_lines_and_discounts_require_review():
    data = XML.replace(b"<TChat>1</TChat>", b"<TChat>3</TChat><TLCKhau>unknown</TLCKhau>")
    _, invoice = read_xml_invoice(data, "discount.xml")
    assert len(invoice.lines) == 1
    assert invoice.lines[0].discount_rate is None
    assert len(invoice.warnings) == 2


def test_invoice_exchange_rate_is_not_applied_to_same_currency_lines():
    _, invoice = read_xml_invoice(
        XML.replace(b"<TGia>1</TGia>", b"<TGia>25000</TGia>"), "foreign.xml"
    )
    assert invoice.lines[0].exchange_rate is None


def test_rejects_ambiguous_numbers_instead_of_guessing():
    with pytest.raises(ValueError, match="invalid decimal"):
        read_xml_invoice(XML.replace(b"10.1250", b"10,1250"), "ambiguous.xml")


def test_xml_upload_uses_real_master_check_without_ocr_or_model_and_keeps_source(tmp_path):
    def never_read(*args, **kwargs):
        raise AssertionError("XML must not use PDF/OCR reading")

    class NeverModel:
        def __getattr__(self, name):
            raise AssertionError("XML must not call a model")

    stages = UploadedMasterStages(model="unused", client=NeverModel())
    options = {"sheet": "CSV", "header": 0, "mapping": {"name": 0, "price": 1, "currency": 2}}
    app = create_app(storage_dir=tmp_path, stages=stages, reader=never_read)
    with TestClient(app) as client:
        master = client.post(
            "/master-list",
            files={"file": ("demo.csv", b"name,price,currency\nDemo part,9,VND\n")},
            data={"options": json.dumps(options)},
        )
        assert master.status_code == 201, master.text
        response = client.post("/invoices", files={"file": ("../demo.XML", XML, "application/xml")})
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["filename"] == "demo.XML"
        assert saved["invoice"]["lines"][0]["unit_price"] == "10.1250"
        assert saved["check"]["lines"][0]["status"] == "price_mismatch"
        assert saved["check"]["overcharge_total"] == "2.25"
        original = client.get(saved["file_url"])
        assert original.content == XML
        assert original.headers["content-type"].startswith("application/xml")
        assert original.headers["x-content-type-options"] == "nosniff"
        assert (
            client.put(
                f"/invoices/{saved['id']}/outcome", json={"outcome": "ready_to_pay"}
            ).status_code
            == 409
        )
        # Missing totals block Ready to pay even when the item price matches.
        matching = (
            XML.replace(b"10.1250", b"9")
            .replace(b"20.25", b"18")
            .replace(b"<TgTThue>1.62</TgTThue>", b"")
        )
        result = client.post("/invoices", files={"file": ("incomplete.xml", matching)}).json()
        assert result["check"]["overcharge_total"] is None
        assert (
            client.put(
                f"/invoices/{result['id']}/outcome", json={"outcome": "ready_to_pay"}
            ).status_code
            == 409
        )
        invalid = client.post("/invoices", files={"file": ("unknown.xml", b"<Invoice/>")})
        assert invalid.status_code == 422
        assert len(client.get("/invoices").json()) == 2
    with TestClient(create_app(storage_dir=tmp_path, stages=stages, reader=never_read)) as client:
        assert client.get(saved["file_url"]).content == XML
        assert client.get(f"/invoices/{saved['id']}").json()["invoice"] == saved["invoice"]


def test_xml_warnings_cannot_be_cleared_by_a_legacy_checker(tmp_path):
    from api.contracts import CheckResult, LineResult

    class LegacyStages:
        mode = "live"
        price_sheet_version = "legacy"

        def extract(self, document):
            raise AssertionError("XML must not use model extraction")

        def check(self, invoice):
            return CheckResult(
                price_sheet_version=self.price_sheet_version,
                lines=[
                    LineResult(
                        line_index=0,
                        status="match",
                        reason="Legacy match",
                        invoice_price="10.1250",
                        agreed_price="10.1250",
                        difference="0",
                        overcharge="0",
                    )
                ],
                overcharge_total="0",
                warnings=[],
            )

    with TestClient(create_app(storage_dir=tmp_path, stages=LegacyStages())) as client:
        data = XML.replace(b"<TChat>1</TChat>", b"<TChat>3</TChat>")
        result = client.post("/invoices", files={"file": ("special.xml", data)}).json()
        assert result["check"]["overcharge_total"] is None
        assert result["check"]["warnings"]
        assert (
            client.put(
                f"/invoices/{result['id']}/outcome", json={"outcome": "ready_to_pay"}
            ).status_code
            == 409
        )
