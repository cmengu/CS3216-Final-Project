import sqlite3

import pytest
from fastapi.testclient import TestClient
from test_api import DATA, lightweight_reader

from api.app import create_app
from api.jobs import InvoiceWorker
from api.stages import FixtureStages
from api.storage import Store


def app_for(path, **kwargs):
    return create_app(
        storage_dir=path,
        stages=FixtureStages(DATA),
        reader=kwargs.pop("reader", lightweight_reader),
        start_worker=False,
        **kwargs,
    )


def upload(client, **kwargs):
    result = client.post(
        "/invoices",
        files={"file": ("invoice.pdf", (DATA / "invoice-02.pdf").read_bytes(), "application/pdf")},
        **kwargs,
    )
    assert result.status_code == 201, result.text
    return result.json()


def work(app):
    worker = InvoiceWorker(app)
    job = app.state.jobs.claim(worker.owner)
    assert job is not None
    worker.process(job)


def test_failed_invoice_joins_queue_while_processing_slot_is_busy(tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client)
        iid = original["id"]
        app.state.store.update(iid, "failed", error="extracting: model unavailable")
        assert app.state.slot.acquire(blocking=False)
        try:
            response = client.post(f"/invoices/{iid}/reprocess")
            assert response.status_code == 200, response.text
            queued = response.json()
            assert queued["status"] == "queued"
            assert queued["id"] == iid
            assert queued["project_id"] == original["project_id"]
            assert queued["error"] is queued["invoice"] is queued["check"] is None
            assert client.post(f"/invoices/{iid}/reprocess").status_code == 409
        finally:
            app.state.slot.release()
        work(app)
        assert client.get(f"/invoices/{iid}").json()["status"] == "completed"
        assert len(client.get("/invoices").json()) == 1
        assert client.get(f"/invoices/{iid}/file").content == (DATA / "invoice-02.pdf").read_bytes()


def test_queued_retry_survives_restart_with_force_ocr(tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client)
        iid = original["id"]
        assert client.post(f"/invoices/{iid}/reprocess?force_ocr=true").json()["status"] == "queued"
    calls = []

    def reader(path, *, force_ocr=False):
        calls.append(force_ocr)
        return lightweight_reader(path, force_ocr=force_ocr)

    restarted = app_for(tmp_path, reader=reader)
    with TestClient(restarted) as client:
        assert client.get(f"/invoices/{iid}").json()["status"] == "queued"
        work(restarted)
        assert calls == [True]
        assert client.get(f"/invoices/{iid}").json()["status"] == "completed"


def test_queue_full_does_not_clear_previous_invoice_results_or_decision(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_WORKSPACE_PENDING", "1")
    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client)
        iid = original["id"]
        app.state.store.decide(iid, "ready_to_pay_anyway", "Approved manually")
        before = client.get(f"/invoices/{iid}").json()
        response = client.post(
            "/invoice-batches",
            files=[
                ("files", ("other.pdf", (DATA / "invoice-01.pdf").read_bytes(), "application/pdf"))
            ],
        )
        assert response.status_code == 202, response.text
        response = client.post(f"/invoices/{iid}/reprocess")
        assert response.status_code == 503, response.text
        assert client.get(f"/invoices/{iid}").json() == before


def test_retry_only_accesses_the_owners_invoice(tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client, headers={"X-Invoice-Session": "owner"})
        response = client.post(
            f"/invoices/{original['id']}/reprocess", headers={"X-Invoice-Session": "other"}
        )
        assert response.status_code == 404
        assert (
            client.get(f"/invoices/{original['id']}", headers={"X-Invoice-Session": "owner"}).json()
            == original
        )


def test_retry_of_existing_job_resets_attempts_and_clears_decision(tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/invoice-batches",
            files=[
                (
                    "files",
                    ("invoice.pdf", (DATA / "invoice-02.pdf").read_bytes(), "application/pdf"),
                )
            ],
        )
        assert response.status_code == 202
        iid = response.json()["invoices"][0]["id"]
        work(app)
        with app.state.store.connect() as db:
            db.execute("UPDATE invoice_jobs SET attempts=3 WHERE invoice_id=?", (iid,))
        app.state.store.decide(iid, "ready_to_pay_anyway", "Manual decision")
        response = client.post(f"/invoices/{iid}/reprocess")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "queued"
        assert response.json()["outcome"] is None
        with app.state.store.connect() as db:
            row = db.execute(
                "SELECT status,attempts FROM invoice_jobs WHERE invoice_id=?", (iid,)
            ).fetchone()
            assert dict(row) == {"status": "queued", "attempts": 0}
        work(app)
        assert client.get(f"/invoices/{iid}").json()["status"] == "completed"


def test_retry_preserves_totals_only_mode(tmp_path, monkeypatch):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        group = client.post(
            "/projects", json={"name": "Expenses", "comparison_mode": "totals_only"}
        ).json()
        original = upload(client, params={"project_id": group["id"]})
        monkeypatch.setattr(
            app.state.stages, "check", lambda *_: pytest.fail("Totals-only invoice checked")
        )
        iid = original["id"]
        response = client.post(f"/invoices/{iid}/reprocess")
        assert response.status_code == 200
        assert response.json()["status"] == "queued"
        assert response.json()["comparison_mode"] == "totals_only"
        work(app)
        result = client.get(f"/invoices/{iid}").json()
        assert result["status"] == "completed"
        assert result["check"] is None
        assert result["price_sheet_version"] == ""
        assert (
            client.put(f"/invoices/{iid}/outcome", json={"outcome": "ready_to_pay"}).status_code
            == 409
        )


def test_queue_schema_upgrade_preserves_old_jobs(tmp_path):
    with sqlite3.connect(tmp_path / "invoices.sqlite3") as db:
        db.execute(
            "CREATE TABLE invoice_jobs (invoice_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, "
            "workspace_id TEXT NOT NULL, status TEXT NOT NULL, master_version TEXT NOT NULL, "
            "created_at TEXT NOT NULL, owner TEXT, lease_until BIGINT NOT NULL DEFAULT 0, "
            "attempts INTEGER NOT NULL DEFAULT 0)"
        )
        db.execute(
            "INSERT INTO invoice_jobs VALUES ('old','batch','default','queued','v1','2026-11-22',NULL,0,0)"
        )
    store = Store(tmp_path)
    with store.connect() as db:
        row = db.execute("SELECT * FROM invoice_jobs WHERE invoice_id='old'").fetchone()
        assert row["force_ocr"] == 0
        assert row["status"] == "queued"


def test_retry_pins_current_group_master_until_execution(tmp_path):
    from test_xml_invoice import XML

    from api.uploaded_master import UploadedMasterStages

    app = create_app(
        storage_dir=tmp_path,
        stages=UploadedMasterStages(model="unused-xml"),
        reader=lightweight_reader,
        start_worker=False,
    )
    with TestClient(app) as client:
        group = client.post(
            "/projects", json={"name": "Supplier", "comparison_mode": "master_list"}
        ).json()
        pid = group["id"]

        def master(price, replace=False):
            response = (client.put if replace else client.post)(
                f"/master-list?project_id={pid}",
                files={"file": ("prices.csv", f"name,price\nDEMO-PART,{price}\n".encode())},
            )
            assert response.is_success, response.text
            return response.json()["version"]

        first = master("10.1250")
        response = client.post(
            f"/invoice-batches?project_id={pid}", files=[("files", ("invoice.xml", XML))]
        )
        assert response.status_code == 202, response.text
        iid = response.json()["invoices"][0]["id"]
        work(app)
        assert client.get(f"/invoices/{iid}").json()["price_sheet_version"] == first
        second = master("99", replace=True)
        queued = client.post(f"/invoices/{iid}/reprocess")
        assert queued.status_code == 200, queued.text
        assert queued.json()["price_sheet_version"] == second
        master("77", replace=True)
        work(app)
        result = client.get(f"/invoices/{iid}").json()
        assert result["status"] == "completed"
        assert result["price_sheet_version"] == result["check"]["price_sheet_version"] == second
        assert result["check"]["lines"][0]["agreed_price"] == "99"


def test_retry_respects_optional_checking_quotas_without_losing_results(tmp_path, monkeypatch):
    monkeypatch.setenv("INVOICE_CHECKS_PER_DAY", "1")
    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client)
        response = client.post(f"/invoices/{original['id']}/reprocess")
        assert response.status_code == 429
        assert response.headers["Retry-After"]
        assert client.get(f"/invoices/{original['id']}").json() == original


def test_retry_is_processed_by_the_running_worker_after_capacity_frees(tmp_path):
    import time

    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), reader=lightweight_reader)
    with TestClient(app) as client:
        original = upload(client)
        iid = original["id"]
        app.state.store.update(iid, "failed", error="extracting: model unavailable")
        assert app.state.slot.acquire(blocking=False)
        try:
            response = client.post(f"/invoices/{iid}/reprocess")
            assert response.status_code == 200, response.text
            assert response.json()["status"] == "queued"
            assert client.get(f"/invoices/{iid}").json()["status"] == "queued"
        finally:
            app.state.slot.release()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = client.get(f"/invoices/{iid}").json()
            if result["status"] == "completed":
                break
            time.sleep(0.05)
        assert result["status"] == "completed"


def test_simultaneous_retries_only_create_one_queued_attempt(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    app = app_for(tmp_path)
    with TestClient(app) as client:
        original = upload(client)
        iid = original["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(client.post, f"/invoices/{iid}/reprocess") for _ in range(2)]
            responses = [future.result(timeout=10) for future in futures]
        assert sorted(response.status_code for response in responses) == [200, 409]
        with app.state.store.connect() as db:
            assert (
                db.execute(
                    "SELECT COUNT(*) FROM invoice_jobs WHERE invoice_id=?", (iid,)
                ).fetchone()[0]
                == 1
            )
        work(app)
        assert client.get(f"/invoices/{iid}").json()["status"] == "completed"
