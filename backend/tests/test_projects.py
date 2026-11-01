"""Projects isolate master snapshots, invoices and currency totals on both stores."""

import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_api import DATA, lightweight_reader
from test_extract import FakeClient, completed
from test_live import invoice
from test_storage_sessions import session_store  # noqa: F401
from test_uploaded_master import OPTIONS

from api.app import create_app
from api.contracts import InvoiceSummary
from api.storage import Store
from api.uploaded_master import UploadedMasterStages


def project(client, name, mode="totals_only", headers=None):
    response = client.post(
        "/projects", json={"name": name, "comparison_mode": mode}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def master(client, pid, price="12", method="post", headers=None):
    data = f"Description,Rate,CCY,UOM,Code,Vendor,Order,Discount,GST\nPart,{price},SGD,PC,PART,Supplier,PO-1,5%,9%\n"
    return getattr(client, method)(
        f"/master-list?project_id={pid}",
        files={"file": ("prices.csv", data.encode())},
        data={"options": json.dumps(OPTIONS)},
        headers=headers,
    )


def upload(client, pid, headers=None):
    return client.post(
        f"/invoices?project_id={pid}",
        files={"file": ("invoice.pdf", (DATA / "invoice-01.pdf").read_bytes())},
        headers=headers,
    )


@pytest.fixture
def client(tmp_path):
    stages = UploadedMasterStages(model="test", client=FakeClient(completed(invoice())))
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        yield client


def test_no_master_extracts_without_check_or_approval(client, monkeypatch):
    p = project(client, "Expenses")
    # A totals-only upload must never call the checker, even with a master elsewhere.
    monkeypatch.setattr("api.csv_live.LiveStages.check", lambda *_: pytest.fail("Checker called"))
    response = upload(client, p["id"])
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["project_id"] == p["id"]
    assert saved["comparison_mode"] == "totals_only"
    assert saved["check"] is None
    assert saved["price_sheet_version"] == ""
    assert saved["invoice"]["invoice_total"] is not None
    result = client.get(f"/projects/{p['id']}").json()
    assert result["totals"] == {"SGD": saved["invoice"]["invoice_total"]}
    assert result["included_count"] == 1
    assert (
        client.put(
            f"/invoices/{saved['id']}/outcome",
            json={"outcome": "ready_to_pay_anyway", "reason": "Test"},
        ).status_code
        == 409
    )
    assert master(client, p["id"]).status_code == 409


def test_project_masters_are_required_isolated_and_snapshotted(client):
    a, b = [project(client, n, "master_list") for n in ("A", "B")]
    assert upload(client, a["id"]).status_code == 409
    assert client.get("/invoices").json() == []
    first = master(client, a["id"], "10")
    assert first.status_code == 201
    assert upload(client, b["id"]).status_code == 409
    assert master(client, b["id"], "12").status_code == 201
    saved_a, saved_b = upload(client, a["id"]).json(), upload(client, b["id"]).json()
    assert saved_a["check"]["lines"][0]["agreed_price"] == "10"
    assert saved_b["check"]["lines"][0]["status"] == "match"
    assert master(client, a["id"], "9", method="put").status_code == 200
    assert client.get(f"/invoices/{saved_a['id']}").json()["check"] == saved_a["check"]
    version = first.json()["version"]
    assert client.get(f"/master-list/versions/{version}?project_id={b['id']}").status_code == 404
    assert len(client.get(f"/master-list/events?project_id={a['id']}").json()) == 2
    assert len(client.get(f"/master-list/events?project_id={b['id']}").json()) == 1
    assert [i["id"] for i in client.get(f"/invoices?project_id={a['id']}").json()] == [
        saved_a["id"]
    ]


def test_cross_session_projects_fail_before_read_or_write(client):
    p = project(client, "Private", headers={"x-invoice-session": "alice"})
    bob = {"x-invoice-session": "bob"}
    assert client.get("/projects", headers=bob).json() == []
    for path in (
        f"/projects/{p['id']}",
        f"/invoices?project_id={p['id']}",
        f"/master-list?project_id={p['id']}",
        f"/master-list/events?project_id={p['id']}",
    ):
        assert client.get(path, headers=bob).status_code == 404
    assert upload(client, p["id"], bob).status_code == 404
    assert master(client, p["id"], headers=bob).status_code == 404
    assert upload(client, "missing").status_code == 404
    assert (
        client.post("/projects", json={"name": "   ", "comparison_mode": "totals_only"}).status_code
        == 422
    )


def test_totals_keep_currencies_separate_and_count_exclusions(session_store):  # noqa: F811
    store = session_store
    p = store.create_project("Travel", "totals_only", session_id="alice")
    other = store.create_project("Other", "totals_only", session_id="alice")
    for pid, currency, total, status in [
        (p["id"], "USD", "10.10", "completed"),
        (p["id"], "USD", "20.20", "completed"),
        (p["id"], "SGD", "5.00", "completed"),
        (p["id"], None, "5.00", "completed"),
        (p["id"], "USD", None, "completed"),
        (p["id"], "USD", "999.00", "failed"),
        (other["id"], "USD", "500.00", "completed"),
    ]:
        iid = str(uuid4())
        store.path(iid).write_bytes(b"%PDF test")
        store.insert(
            iid,
            "test.pdf",
            iid,
            "live",
            "",
            session_id="alice",
            project_id=pid,
            comparison_mode="totals_only",
        )
        record = invoice().model_copy(update={"currency": currency, "invoice_total": total})
        store.update(iid, status, invoice=record)
    totals = store.project_totals(p["id"], session_id="alice")
    assert totals == {
        "invoice_count": 5,
        "included_count": 3,
        "excluded_count": 2,
        "totals": {"SGD": "5.00", "USD": "30.30"},
    }
    assert store.project_totals(p["id"], session_id="bob")["invoice_count"] == 0
    assert store.get_project(p["id"], session_id="bob") is None


def test_legacy_migration_is_idempotent_and_preserves_data(tmp_path):
    # Build the pre-project SQLite schema, then run the production initializer twice.
    with sqlite3.connect(tmp_path / "invoices.sqlite3") as db:
        db.execute(
            "CREATE TABLE invoices (id TEXT PRIMARY KEY,filename TEXT NOT NULL,document_hash TEXT NOT NULL,status TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT,price_sheet_version TEXT NOT NULL, document TEXT,invoice TEXT,check_result TEXT, session_id TEXT NOT NULL)"
        )
        db.execute(
            "INSERT INTO invoices VALUES ('old','old.pdf','hash','completed','live','2026-01-01','2026-01-01',NULL,'v1',NULL,NULL,NULL,'alice')"
        )
    store = Store(tmp_path)
    again = Store(tmp_path)
    assert again.list_projects(session_id="alice") == store.list_projects(session_id="alice")
    assert len(again.list_projects(session_id="alice")) == 1
    saved = again.get("old", session_id="alice")
    assert saved.project_id == "legacy:alice"
    assert saved.comparison_mode == "master_list"
    assert isinstance(again.list(10, 0, session_id="alice")[0], InvoiceSummary)


def test_projects_require_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    stages = UploadedMasterStages(model="test", client=FakeClient(completed(invoice())))
    with TestClient(create_app(storage_dir=tmp_path, stages=stages)) as client:
        assert client.get("/projects").status_code == 401
        assert (
            client.post(
                "/projects", json={"name": "Test", "comparison_mode": "totals_only"}
            ).status_code
            == 401
        )


def test_legacy_file_checker_cannot_override_project_master(tmp_path):
    class LegacyStages:
        mode = "live"
        price_sheet_version = "file-backed"

        def extract(self, document):
            pytest.fail("Must not use a legacy checker for project uploads")

    with TestClient(create_app(storage_dir=tmp_path, stages=LegacyStages())) as client:
        p = project(client, "Expenses")
        assert upload(client, p["id"]).status_code == 503
        assert client.get("/invoices").json() == []
