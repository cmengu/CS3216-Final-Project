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
    monkeypatch.setenv("INVOICE_CHECKER", "standard")
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


def _upload(client, name):
    data = (DATA / name).read_bytes()
    return client.post("/invoices", files={"file": (name, data, "application/pdf")}).json()


def _decide(client, saved, outcome, reason=None):
    return client.put(
        f"/invoices/{saved['id']}/outcome", json={"outcome": outcome, "reason": reason}
    )


def test_an_outcome_is_saved_listed_and_kept_across_restart(tmp_path):
    stages = FixtureStages(DATA)
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        clean = _upload(client, "invoice-01.pdf")
        assert (clean["outcome"], clean["outcome_reason"], clean["decided_at"]) == (None,) * 3
        response = _decide(client, clean, "ready_to_pay")
        assert response.status_code == 200, response.text
        decided = response.json()
        assert decided["outcome"] == "ready_to_pay" and decided["decided_at"]
        assert decided["updated_at"] == clean["updated_at"]
        assert client.get("/invoices").json()[0]["outcome"] == "ready_to_pay"

    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as c:
        assert c.get(f"/invoices/{clean['id']}").json() == decided


def test_clearing_an_outcome_is_undo(tmp_path):
    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        over = _upload(client, "invoice-02.pdf")
        assert _decide(client, over, "raise_with_supplier").json()["outcome"] == (
            "raise_with_supplier"
        )
        cleared = _decide(client, over, None).json()
        assert (cleared["outcome"], cleared["outcome_reason"], cleared["decided_at"]) == (None,) * 3
        assert _decide(client, over, None, "why").status_code == 422


def test_ready_to_pay_only_when_checked_in_full_and_every_line_matches(tmp_path):
    def unreadable(*args, **kwargs):
        raise ValueError("No readable text or tables")

    stages = FixtureStages(DATA)
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        for name in ("invoice-02.pdf", "invoice-03.pdf", "invoice-05.pdf", "invoice-08.pdf"):
            response = _decide(client, _upload(client, name), "ready_to_pay")
            assert response.status_code == 409, name
            assert "every line matching" in response.json()["detail"]
    with TestClient(create_app(storage_dir=tmp_path, stages=stages, reader=unreadable)) as client:
        assert _decide(client, _upload(client, "invoice-01.pdf"), "ready_to_pay").status_code == 409


def test_ready_to_pay_anyway_needs_a_reason_and_a_finished_invoice(tmp_path):
    def unreadable(*args, **kwargs):
        raise ValueError("No readable text or tables")

    stages = FixtureStages(DATA)
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        over = _upload(client, "invoice-02.pdf")
        for reason in (None, "", "   "):
            response = _decide(client, over, "ready_to_pay_anyway", reason)
            assert response.status_code == 422
            assert response.json()["detail"] == "Ready to pay anyway needs a short reason"
        assert _decide(client, over, "ready_to_pay_anyway", "x" * 501).status_code == 422
        saved = _decide(client, over, "ready_to_pay_anyway", "  Credit note agreed  ").json()
        assert saved["outcome_reason"] == "Credit note agreed"

        app = client.app
        app.state.store.insert("00000000-0000-4000-8000-000000000001", "x.pdf", "h", "fixture", "v")
        stuck = {"id": "00000000-0000-4000-8000-000000000001"}
        assert _decide(client, stuck, "ready_to_pay_anyway", "Checked by hand").status_code == 409

    with TestClient(create_app(storage_dir=tmp_path, stages=stages, reader=unreadable)) as client:
        failed = _upload(client, "invoice-01.pdf")
        response = _decide(client, failed, "ready_to_pay_anyway", "Checked by hand")
        assert response.status_code == 200 and response.json()["status"] == "failed"


def test_raise_with_supplier_needs_a_line_over_the_sheet_price(tmp_path):
    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        for name in ("invoice-01.pdf", "invoice-03.pdf", "invoice-08.pdf"):
            response = _decide(client, _upload(client, name), "raise_with_supplier")
            assert response.status_code == 409, name
        assert _decide(client, _upload(client, "invoice-06.pdf"), "raise_with_supplier").is_success
        assert _decide(client, {"id": "not-an-id"}, "ready_to_pay").status_code == 422
        missing = {"id": "00000000-0000-0000-0000-000000000000"}
        assert _decide(client, missing, "ready_to_pay").status_code == 404
        assert _decide(client, _upload(client, "invoice-01.pdf"), "paid").status_code == 422


def test_a_database_from_before_outcomes_gains_the_columns(tmp_path):
    import sqlite3

    with sqlite3.connect(tmp_path / "invoices.sqlite3") as db:
        db.execute("""CREATE TABLE invoices (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, document_hash TEXT NOT NULL,
            status TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, error TEXT, price_sheet_version TEXT NOT NULL,
            document TEXT, invoice TEXT, check_result TEXT
        )""")
        db.execute(
            "INSERT INTO invoices VALUES ('a','x.pdf','h','failed','fixture','t','t','e','v',"
            "NULL,NULL,NULL)"
        )
    db.close()
    store = Store(tmp_path)
    assert store.list(10, 0)[0].outcome is None
    store.decide("a", "ready_to_pay_anyway", "Checked by hand")
    assert store.get("a").outcome_reason == "Checked by hand"


def test_live_mode_uses_uploaded_list_not_env_path(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_MODE", "live")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    monkeypatch.setenv("INVOICE_PRICE_SHEET", "/missing/demo.csv")
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert client.get("/health").json()["mode"] == "live"
        response = client.post("/invoices", files={"file": ("x.pdf", b"%PDF-fake")})
        assert response.status_code == 409
        assert "Upload a master list" in response.json()["detail"]
        assert client.get("/invoices").json() == []


def test_preview_origins_are_allowed_by_pattern_and_others_are_not(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "INVOICE_ALLOWED_ORIGIN_REGEX", r"https://invoice-checker-[a-z0-9-]+-team\.vercel\.app"
    )
    with TestClient(create_app(storage_dir=tmp_path)) as client:

        def allowed(origin):
            response = client.options(
                "/health",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
            return response.headers.get("access-control-allow-origin") == origin

        assert allowed("https://invoice-checker-jv4e1u5tr-team.vercel.app")
        assert allowed("http://localhost:3000")
        assert not allowed("https://invoice-checker-jv4e1u5tr-team.vercel.app.evil.com")
        assert not allowed("https://evil.vercel.app")
