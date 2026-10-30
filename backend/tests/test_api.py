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


def test_session_isolation_prevents_other_sessions_from_viewing_or_deciding_documents(tmp_path):
    stages = FixtureStages(DATA)
    app = create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    with TestClient(app) as client:
        alice_headers = {"X-Invoice-Session": "session-alice"}
        bob_headers = {"X-Invoice-Session": "session-bob"}

        alice_doc = client.post(
            "/invoices",
            headers=alice_headers,
            files={
                "file": (
                    "invoice-01.pdf",
                    (DATA / "invoice-01.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        ).json()
        bob_doc = client.post(
            "/invoices",
            headers=bob_headers,
            files={
                "file": (
                    "invoice-02.pdf",
                    (DATA / "invoice-02.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        ).json()

        # Each session only lists its own uploaded documents
        alice_list = client.get("/invoices", headers=alice_headers).json()
        bob_list = client.get("/invoices", headers=bob_headers).json()
        assert [row["id"] for row in alice_list] == [alice_doc["id"]]
        assert [row["id"] for row in bob_list] == [bob_doc["id"]]

        # Alice cannot read, download, or decide Bob's invoice
        assert client.get(f"/invoices/{bob_doc['id']}", headers=alice_headers).status_code == 404
        assert (
            client.get(f"/invoices/{bob_doc['id']}/file", headers=alice_headers).status_code == 404
        )
        assert (
            client.get(f"/invoices/{bob_doc['id']}/file?session_id=session-alice").status_code
            == 404
        )
        assert (
            client.put(
                f"/invoices/{bob_doc['id']}/outcome",
                headers=alice_headers,
                json={"outcome": "raise_with_supplier"},
            ).status_code
            == 404
        )

        # Bob can download via session_id query param and decide his own invoice
        assert (
            client.get(f"/invoices/{bob_doc['id']}/file?session_id=session-bob").status_code == 200
        )
        assert (
            client.put(
                f"/invoices/{bob_doc['id']}/outcome",
                headers=bob_headers,
                json={"outcome": "raise_with_supplier"},
            ).status_code
            == 200
        )


def test_concurrent_multi_user_uploads_queue_and_isolate_by_session(tmp_path, monkeypatch):
    import time
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setenv("INVOICE_SLOT_WAIT_SECONDS", "10")

    def slow_reader(path, *, force_ocr=False):
        time.sleep(0.05)
        return lightweight_reader(path, force_ocr=force_ocr)

    stages = FixtureStages(DATA)
    app = create_app(storage_dir=tmp_path, stages=stages, reader=slow_reader)
    pdf_bytes = (DATA / "invoice-01.pdf").read_bytes()

    with TestClient(app) as client:

        def upload_for_session(idx: int):
            sid = f"concurrent-session-{idx}"
            resp = client.post(
                "/invoices",
                headers={"X-Invoice-Session": sid},
                files={"file": (f"user-{idx}.pdf", pdf_bytes, "application/pdf")},
            )
            return sid, resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(upload_for_session, range(4)))

        for sid, status_code, body in results:
            assert status_code == 201
            listed = client.get("/invoices", headers={"X-Invoice-Session": sid}).json()
            assert [row["id"] for row in listed] == [body["id"]]


def test_gpu_accelerator_detection_prefers_cuda_and_falls_back_to_cpu(monkeypatch):
    import sys
    from types import SimpleNamespace

    from read.reader import detect_ocr_accelerator

    monkeypatch.setenv("INVOICE_OCR_DEVICE", "cpu")
    cpu_info = detect_ocr_accelerator()
    assert cpu_info["device"] == "cpu"
    assert cpu_info["torch_cuda"] is False
    assert cpu_info["ort_cuda"] is False
    assert cpu_info["num_threads"] >= 1

    # Simulate an NVIDIA RTX 4070 with CUDA available in both PyTorch and ONNX Runtime
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            get_device_name=lambda idx: "NVIDIA GeForce RTX 4070",
        )
    )
    fake_ort = SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)

    monkeypatch.setenv("INVOICE_OCR_DEVICE", "auto")
    cuda_info = detect_ocr_accelerator()
    assert cuda_info["device"] == "cuda"
    assert cuda_info["torch_cuda"] is True
    assert cuda_info["ort_cuda"] is True
    assert cuda_info["gpu_name"] == "NVIDIA GeForce RTX 4070"


def test_session_isolation_for_master_list_and_outlook(tmp_path, monkeypatch):
    from urllib.parse import parse_qs, urlparse

    monkeypatch.setenv("MICROSOFT_CLIENT_ID", "client-id-123")
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "client-secret-xyz")
    monkeypatch.setenv("MICROSOFT_REDIRECT_URI", "http://localhost:8001/auth/outlook/callback")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")

    monkeypatch.setattr(
        "api.outlook._exchange_code_for_tokens",
        lambda cfg, code, verifier: {
            "access_token": "alice-access-token",
            "refresh_token": "alice-refresh-token",
            "expires_in": 3600,
        },
    )
    monkeypatch.setattr(
        "api.outlook._fetch_graph_profile",
        lambda token: {
            "displayName": "Alice Wong",
            "mail": "alice@company.example",
        },
    )

    alice_headers = {"X-Invoice-Session": "session-alice"}
    bob_headers = {"X-Invoice-Session": "session-bob"}

    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        # 1. Master list isolation: Alice uploads a master list; Bob sees None and empty events
        alice_csv = b"name,price,quantity\nBolt,1.20,10\n"
        bob_csv = b"name,price,quantity\nWasher,0.50,100\n"
        csv_options = '{"sheet":"CSV","header":0,"mapping":{"name":0,"price":1,"quantity":2}}'

        res_alice = client.post(
            "/master-list",
            headers=alice_headers,
            files={"file": ("alice-prices.csv", alice_csv, "text/csv")},
            data={"options": csv_options},
        )
        assert res_alice.status_code == 201
        alice_master = res_alice.json()
        assert alice_master["file"] == "alice-prices.csv"

        assert client.get("/master-list", headers=bob_headers).json() is None
        assert client.get("/master-list/events", headers=bob_headers).json() == []
        assert (
            client.get(
                f"/master-list/versions/{alice_master['version']}",
                headers=bob_headers,
            ).status_code
            == 404
        )

        # Bob can upload his own initial master list with POST (not blocked by Alice's list)
        res_bob = client.post(
            "/master-list",
            headers=bob_headers,
            files={"file": ("bob-prices.csv", bob_csv, "text/csv")},
            data={"options": csv_options},
        )
        assert res_bob.status_code == 201
        assert client.get("/master-list", headers=bob_headers).json()["file"] == "bob-prices.csv"
        assert (
            client.get("/master-list", headers=alice_headers).json()["file"] == "alice-prices.csv"
        )

        # 2. Outlook OAuth isolation: Alice connects Outlook; Bob remains disconnected
        login_res = client.get(
            "/auth/outlook/login?return_to=/invoices&session_id=session-alice",
            follow_redirects=False,
        )
        assert login_res.status_code == 302
        state = parse_qs(urlparse(login_res.headers["location"]).query)["state"][0]

        cb_res = client.get(
            f"/auth/outlook/callback?code=code-123&state={state}",
            follow_redirects=False,
        )
        assert cb_res.status_code == 302

        alice_status = client.get("/outlook/status", headers=alice_headers).json()
        bob_status = client.get("/outlook/status", headers=bob_headers).json()
        assert alice_status["connected"] is True
        assert alice_status["email"] == "alice@company.example"
        assert bob_status["connected"] is False
        assert bob_status["email"] is None

        # Bob disconnecting does not disconnect Alice
        client.post("/outlook/disconnect", headers=bob_headers)
        assert client.get("/outlook/status", headers=alice_headers).json()["connected"] is True


def test_httponly_cookie_auth_sign_in_me_and_sign_out_with_strict_enforcement(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", "approved-admin")
    monkeypatch.setenv("AUTH_PASSWORD", "isolated-admin-password-2026")

    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        client.headers.update({"X-Requested-With": "InvoiceChecker"})
        # 1. Protected endpoints reject unauthenticated requests and unsigned headers
        assert client.get("/invoices").status_code == 401
        assert client.get("/master-list").status_code == 401
        assert client.get("/outlook/status").status_code == 401
        assert (
            client.get("/invoices", headers={"X-Invoice-Session": "forged-plain-uuid"}).status_code
            == 401
        )
        assert (
            client.get(
                "/invoices", headers={"Cookie": "ic_session=ic1.forged.signature"}
            ).status_code
            == 401
        )
        assert client.get("/auth/me").status_code == 401

        # 2. Invalid credentials rejected
        bad_login = client.post(
            "/auth/sign-in", json={"username": "approved-admin", "password": "wrong"}
        )
        assert bad_login.status_code == 401

        # 3. Valid credentials set an HttpOnly signed cookie and omit provider="password"
        good_login = client.post(
            "/auth/sign-in",
            json={"username": "approved-admin", "password": "isolated-admin-password-2026"},
        )
        assert good_login.status_code == 200
        body = good_login.json()
        assert body["ok"] is True
        assert body["user"]["email"] == "approved-admin"
        assert body["user"]["role"] == "admin"
        assert "provider" not in body["user"]
        set_cookie = good_login.headers.get("set-cookie", "")
        assert "ic_session=ic1." in set_cookie
        assert "HttpOnly" in set_cookie

        # 4. Subsequent requests use the HttpOnly cookie automatically
        me_res = client.get("/auth/me")
        assert me_res.status_code == 200
        assert me_res.json()["authenticated"] is True
        assert me_res.json()["user"]["email"] == "approved-admin"

        upload_res = client.post(
            "/invoices",
            files={
                "file": (
                    "invoice-01.pdf",
                    (DATA / "invoice-01.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        )
        assert upload_res.status_code == 201
        assert len(client.get("/invoices").json()) == 1

        # 5. Sign-out clears the cookie and revokes access
        out_res = client.post("/auth/sign-out")
        assert out_res.status_code == 200
        assert client.get("/auth/me").status_code == 401
        assert client.get("/invoices").status_code == 401


def test_preview_origins_are_allowed_by_pattern_and_others_are_not(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "INVOICE_ALLOWED_ORIGIN_REGEX",
        r"https://isolated-admin-password-2026-[a-z0-9-]+-team\.vercel\.app",
    )
    with TestClient(create_app(storage_dir=tmp_path)) as client:

        def allowed(origin):
            response = client.options(
                "/health",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
            assert response.headers.get("access-control-allow-credentials") == "true"
            return response.headers.get("access-control-allow-origin") == origin

        assert allowed("https://isolated-admin-password-2026-jv4e1u5tr-team.vercel.app")
        assert allowed("http://localhost:3000")
        assert not allowed(
            "https://isolated-admin-password-2026-jv4e1u5tr-team.vercel.app.evil.com"
        )
        assert not allowed("https://evil.vercel.app")


def test_session_cookie_crosses_sites_only_over_https(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_USERNAME", "approved-admin")
    monkeypatch.setenv("AUTH_PASSWORD", "isolated-admin-password-2026")
    login = {"username": "approved-admin", "password": "isolated-admin-password-2026"}
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        client.headers.update({"X-Requested-With": "InvoiceChecker"})
        # Railway's proxy ends HTTPS and forwards plain http with X-Forwarded-Proto.
        deployed = (
            client.post("/auth/sign-in", json=login, headers={"X-Forwarded-Proto": "https"})
            .headers["set-cookie"]
            .lower()
        )
        assert "samesite=none" in deployed and "secure" in deployed and "httponly" in deployed

        signed_out = (
            client.post("/auth/sign-out", headers={"X-Forwarded-Proto": "https"})
            .headers["set-cookie"]
            .lower()
        )
        assert "samesite=none" in signed_out and "secure" in signed_out

        local = client.post("/auth/sign-in", json=login).headers["set-cookie"].lower()
        assert "samesite=lax" in local and "secure" not in local
