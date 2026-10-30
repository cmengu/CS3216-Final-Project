"""Complete uploads, restart recovery, pinned master lists, and exclusive job writes."""

import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, login
from test_api import lightweight_reader
from test_xml_invoice import XML

from api.app import create_app
from api.processing import LostLease
from api.stages import FixtureStages
from api.uploaded_master import UploadedMasterStages

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


@pytest.fixture
def configuration(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.delenv("DATABASE_URL", raising=False)


def app_for(directory, reader=lightweight_reader, start_worker=False):
    return create_app(
        storage_dir=directory, stages=FixtureStages(DATA), reader=reader, start_worker=start_worker
    )


def submit(client, names=("invoice-01.pdf", "invoice-02.pdf")):
    response = client.post(
        "/invoice-batches",
        headers=HEADERS,
        files=[("files", (name, (DATA / name).read_bytes(), "application/pdf")) for name in names],
    )
    assert response.status_code == 202, response.text
    return response.json()


def wait_completed(client, batch_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        state = client.get("/invoice-batches/" + batch_id).json()
        if state["completed"] + state["failed"] == state["total"]:
            return state
        time.sleep(0.05)
    raise AssertionError("The persisted batch did not complete")


def test_complete_upload_is_persisted_without_running_reader(configuration, tmp_path):
    def forbidden(*args, **kwargs):
        raise AssertionError("No reader should run during batch acceptance")

    app = app_for(tmp_path, reader=forbidden)
    with TestClient(app) as client:
        login(client)
        receipt = submit(client)
        assert len(receipt["invoices"]) == 2
        assert all(row["status"] == "queued" for row in receipt["invoices"])
        assert client.get("/invoice-batches/" + receipt["id"]).json()["queued"] == 2
        for row in receipt["invoices"]:
            assert client.get(row["file_url"]).content == (DATA / row["filename"]).read_bytes()


def test_queued_batches_resume_after_service_restart(configuration, tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        login(client)
        receipt = submit(client)
    with TestClient(app_for(tmp_path, start_worker=True)) as client:
        login(client)
        status = wait_completed(client, receipt["id"])
        assert status["completed"] == 2 and status["failed"] == 0
        assert len(client.get("/invoices").json()) == 2


def test_closing_browser_does_not_stop_an_uploaded_batch(configuration, tmp_path):
    entered, released = threading.Event(), threading.Event()

    def reader(path, **kwargs):
        entered.set()
        assert released.wait(12)
        return lightweight_reader(path, **kwargs)

    app = app_for(tmp_path, reader=reader, start_worker=True)
    with TestClient(app) as server:
        browser = TestClient(app)
        login(browser)
        receipt = submit(browser, ("invoice-01.pdf",))
        assert entered.wait(10)
        browser.close()
        released.set()
        login(server)
        assert wait_completed(server, receipt["id"])["completed"] == 1


def test_expired_lease_recovers_and_old_worker_cannot_write(configuration, tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        login(client)
        receipt = submit(client, ("invoice-01.pdf",))
        old = app.state.jobs.claim("old-worker")
        with app.state.store.connect() as db:
            db.execute(
                "UPDATE invoice_jobs SET lease_until=0 WHERE invoice_id=?", (old["invoice_id"],)
            )
        replacement = app.state.jobs.claim("new-worker")
        assert replacement["invoice_id"] == old["invoice_id"]
        with pytest.raises(LostLease):
            app.state.jobs.save(old["invoice_id"], "old-worker", "completed")
        app.state.jobs.save(
            old["invoice_id"], "new-worker", "failed", error="reading: synthetic failure"
        )
        assert client.get("/invoices/" + old["invoice_id"]).json()["status"] == "failed"
        assert client.get("/invoice-batches/" + receipt["id"]).json()["failed"] == 1


def test_batch_checks_the_master_version_present_when_uploaded(configuration, tmp_path):
    stages = UploadedMasterStages(model="test-no-model")
    app = create_app(storage_dir=tmp_path, stages=stages, start_worker=False)
    with TestClient(app) as client:
        login(client)
        first = client.post(
            "/master-list",
            headers=HEADERS,
            files={"file": ("prices.csv", b"name,price\nDEMO-PART,10.1250\n", "text/csv")},
        )
        assert first.status_code == 201
        receipt = client.post(
            "/invoice-batches",
            headers=HEADERS,
            files=[("files", ("invoice.xml", XML, "application/xml"))],
        ).json()
        assert receipt["invoices"][0]["price_sheet_version"] == first.json()["version"]
        second = client.put(
            "/master-list",
            headers=HEADERS,
            files={"file": ("prices.csv", b"name,price\nDEMO-PART,99\n", "text/csv")},
        )
        assert second.status_code == 200
    with TestClient(create_app(storage_dir=tmp_path, stages=stages, start_worker=True)) as client:
        login(client)
        assert wait_completed(client, receipt["id"])["completed"] == 1
        saved = client.get("/invoices/" + receipt["invoices"][0]["id"]).json()
        assert saved["check"]["price_sheet_version"] == first.json()["version"]
        assert saved["check"]["lines"][0]["status"] == "match"


def test_batch_failure_is_atomic_and_releases_files(configuration, tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        login(client)
        response = client.post(
            "/invoice-batches",
            headers=HEADERS,
            files=[
                ("files", ("good.pdf", (DATA / "invoice-01.pdf").read_bytes(), "application/pdf")),
                ("files", ("bad.pdf", b"invalid-pdf", "application/pdf")),
            ],
        )
        assert response.status_code == 422
        assert client.get("/invoices").json() == []
        assert list(app.state.store.files.iterdir()) == []


def test_batch_status_is_private_and_exact_duplicates_are_skipped(configuration, tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        login(client)
        receipt = submit(client, ("invoice-01.pdf",))
        duplicate = submit(client, ("invoice-01.pdf",))
        assert duplicate["invoices"] == [] and len(duplicate["duplicates"]) == 1
        other = {"username": "second-member", "password": "second-member-password-2026"}
        assert client.post("/admin/accounts", headers=HEADERS, json=other).status_code == 201
        client.cookies.clear()
        login(client, other)
        assert client.get("/invoice-batches/" + receipt["id"]).status_code == 404
        assert client.get("/invoices").json() == []


def test_storage_and_processing_allowances_apply_before_enqueuing(
    configuration, tmp_path, monkeypatch
):
    monkeypatch.setenv("INVOICE_CHECKS_PER_HOUR", "1")
    app = app_for(tmp_path)
    with TestClient(app) as client:
        login(client)
        refused = client.post(
            "/invoice-batches",
            headers=HEADERS,
            files=[
                ("files", (name, (DATA / name).read_bytes(), "application/pdf"))
                for name in ("invoice-01.pdf", "invoice-02.pdf")
            ],
        )
        assert refused.status_code == 429 and int(refused.headers["Retry-After"]) > 0
        assert client.get("/invoices").json() == []
        assert list(app.state.store.files.iterdir()) == []
