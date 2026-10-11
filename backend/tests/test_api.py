import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from api.app import create_app
from api.contracts import CheckResult
from api.live import LiveStages
from api.stages import FixtureStages
from api.storage import Store
from dummy.cases import CATALOG, build_cases
from dummy.generate import validate_sheet
from read.models import ParsedDocument
from schema import InvoiceRecord

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


def lightweight_reader(path, *, force_ocr=False):
    return ParsedDocument(
        document_hash=hashlib.sha256(path.read_bytes()).hexdigest(),
        filename=path.name,
        page_count=1,
        reader_version="test-reader",
        markdown="Test reader only",
        blocks=[],
        docling_document={},
    )


def test_upload_persists_across_restart_without_reprocessing(tmp_path):
    stages = FixtureStages(DATA)
    data = (DATA / "invoice-02.pdf").read_bytes()
    app = create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    with TestClient(app) as client:
        response = client.post(
            "/invoices", files={"file": ("../../example.pdf", data, "application/pdf")}
        )
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["status"] == "completed" and saved["mode"] == "fixture"
        assert saved["filename"] == "example.pdf"
        assert saved["check"]["lines"][0]["status"] == "price_mismatch"
        assert saved["invoice"]["lines"][1]["unit_price"] == "0.0047"
        assert saved["check"]["overcharge_total"] == "15.00"
        assert client.get(saved["file_url"]).content == data
        assert client.get("/invoices").json()[0]["id"] == saved["id"]

    def never_read(*args, **kwargs):
        raise AssertionError("Restart/retrieval must not reprocess invoices")

    with TestClient(create_app(storage_dir=tmp_path, stages=stages, reader=never_read)) as client:
        assert client.get(f"/invoices/{saved['id']}").json() == saved


def test_disabled_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("INVOICE_MODE", raising=False)
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert client.get("/health").json()["mode"] == "unconfigured"
        response = client.post("/invoices", files={"file": ("x.pdf", b"%PDF-fake")})
        assert response.status_code == 503


def test_invalid_uploads_and_unknown_ids(tmp_path):
    with TestClient(
        create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    ) as client:
        assert client.post("/invoices", files={"file": ("x.txt", b"abc")}).status_code == 415
        assert client.post("/invoices", files={"file": ("x.pdf", b"abc")}).status_code == 422
        assert client.get("/invoices/00000000-0000-0000-0000-000000000000").status_code == 404
        assert client.get("/invoices/not-an-id").status_code == 422
        assert client.get("/invoices?limit=1000").status_code == 422
        assert client.get("/invoices").json() == []
        assert list((tmp_path / "files").glob("*.pdf")) == []


def test_size_limit_and_busy(tmp_path):
    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        assert (
            client.post(
                "/invoices", content=b"x", headers={"Content-Length": str(21 * 1024 * 1024)}
            ).status_code
            == 413
        )
        app.state.slot.acquire()
        try:
            assert client.post("/invoices", files={"file": ("x.pdf", b"%PDF-")}).status_code == 429
        finally:
            app.state.slot.release()


def test_reader_failure_is_saved_and_slot_released(tmp_path):
    def failing_reader(*args, **kwargs):
        raise RuntimeError("Sensitive document/provider detail must not reach response")

    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=failing_reader)
    with TestClient(app) as client:
        data = (DATA / "invoice-01.pdf").read_bytes()
        for _ in range(2):
            response = client.post("/invoices", files={"file": ("x.pdf", data)})
            assert response.status_code == 422
            assert "Sensitive" not in response.text
            assert response.json()["status"] == "failed"
        assert len(client.get("/invoices").json()) == 2


def test_a_step_that_gives_its_reason_has_it_saved_with_the_step_name(tmp_path):
    def unreadable(*args, **kwargs):
        raise ValueError("No readable text or tables; retry with --force-ocr or review manually")

    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=unreadable)
    with TestClient(app) as client:
        data = (DATA / "invoice-01.pdf").read_bytes()
        saved = client.post("/invoices", files={"file": ("x.pdf", data)}).json()
        assert saved["status"] == "failed"
        assert saved["error"].startswith("reading: No readable text or tables")


def test_a_rejected_shape_is_saved_without_the_value_it_quotes(tmp_path):
    class BadExtract(FixtureStages):
        def extract(self, document):
            return InvoiceRecord.model_validate({"supplier_name": "Sensitive Supplier Pte Ltd"})

    app = create_app(storage_dir=tmp_path, stages=BadExtract(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        data = (DATA / "invoice-01.pdf").read_bytes()
        response = client.post("/invoices", files={"file": ("x.pdf", data)})
        assert response.status_code == 422
        assert "Sensitive" not in response.text
        assert response.json()["error"].startswith("extracting: ValidationError")


def test_live_mode_runs_the_real_check_on_a_file_it_has_never_seen(tmp_path):
    answers = json.loads((DATA / "manifest.json").read_text())["cases"][1]["invoice"]
    stages = LiveStages(
        DATA / "price-sheet.xlsx", extract=lambda document: InvoiceRecord.model_validate(answers)
    )
    app = create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    with TestClient(app) as client:
        assert client.get("/health").json()["mode"] == "live"
        changed_copy = (DATA / "invoice-02.pdf").read_bytes() + b"\n% saved again\n"
        response = client.post("/invoices", files={"file": ("new.pdf", changed_copy)})
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved["mode"] == "live"
        assert saved["check"]["lines"][0]["status"] == "price_mismatch"
        assert saved["check"]["overcharge_total"] == "15.00"
        assert saved["price_sheet_version"] == stages.price_sheet_version


def test_live_mode_needs_a_named_price_sheet(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_MODE", "live")
    monkeypatch.delenv("INVOICE_PRICE_SHEET", raising=False)
    with pytest.raises(ValueError, match="INVOICE_PRICE_SHEET"):
        with TestClient(create_app(storage_dir=tmp_path)):
            pass
    monkeypatch.setenv("INVOICE_PRICE_SHEET", str(DATA / "price-sheet.xlsx"))
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert client.get("/health").json() == {
            "status": "ok",
            "mode": "live",
            "processing_configured": True,
            "contract": "proposed-v1",
        }


def test_an_unknown_mode_stops_the_service_from_starting(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_MODE", "demo")
    with pytest.raises(ValueError, match="fixture or live"):
        with TestClient(create_app(storage_dir=tmp_path)):
            pass


def test_interrupted_rows_become_failed_on_startup(tmp_path):
    store = Store(tmp_path)
    store.insert("interrupted", "x.pdf", "hash", "fixture", "version")
    with TestClient(create_app(storage_dir=tmp_path, stages=FixtureStages(DATA))) as client:
        saved = client.get("/invoices").json()[0]
        assert saved["status"] == "failed"
        assert "restart" in saved["error"]


def test_fixture_rejects_unknown_content_and_changed_price_sheet(tmp_path):
    stages = FixtureStages(DATA)
    document = lightweight_reader(DATA / "invoice-01.pdf")
    document.document_hash = "unregistered"
    with pytest.raises(ValueError, match="only PDFs registered"):
        stages.extract(document)
    (tmp_path / "manifest.json").write_bytes((DATA / "manifest.json").read_bytes())
    (tmp_path / "price-sheet.xlsx").write_bytes(b"changed")
    with pytest.raises(ValueError, match="price sheet changed"):
        FixtureStages(tmp_path)


def test_dummy_set_truth_and_scan_integrity():
    manifest = json.loads((DATA / "manifest.json").read_text())
    assert manifest["invented"] is True
    assert len(manifest["cases"]) == 10
    assert {c["layout"] for c in manifest["cases"]} == {0, 1, 2}
    validate_sheet(DATA / "price-sheet.xlsx")
    assert {m["type"] for c in manifest["cases"] for m in c["mistakes"]} >= {
        "unit_price_difference",
        "unknown_part",
        "line_arithmetic",
        "invoice_total_arithmetic",
    }
    source_cases = build_cases()
    for source, case in zip(source_cases, manifest["cases"]):
        assert source["invoice"] == case["invoice"]
        assert source["expected_check"] == case["expected_check"]
        invoice = InvoiceRecord.model_validate(case["invoice"])
        check = CheckResult.model_validate(
            {**case["expected_check"], "price_sheet_version": "test"}
        )
        assert len(check.lines) == len(invoice.lines)
        for file in case["files"]:
            path = DATA / file["name"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == file["sha256"]
            pages = PdfReader(path).pages
            if file["kind"] == "scan":
                assert all(not (page.extract_text() or "").strip() for page in pages)
            else:
                assert case["invoice"]["invoice_number"] in pages[0].extract_text()
    assert len(PdfReader(DATA / "invoice-10.pdf").pages) > 1
    assert any(p["unit_price"] == "0.0047" for p in CATALOG)
