"""Main's project workflows retain their ownership and policies in durable batches."""

import pytest
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, login
from test_api import DATA, lightweight_reader
from test_background_batches import wait_completed
from test_extract import FakeClient, completed
from test_live import invoice
from test_xml_invoice import XML

from api.app import create_app
from api.uploaded_master import UploadedMasterStages


@pytest.fixture(autouse=True)
def configuration(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.delenv("DATABASE_URL", raising=False)


def project(client, name, mode="totals_only"):
    response = client.post(
        "/projects", headers=HEADERS, json={"name": name, "comparison_mode": mode}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def submit(client, pid, filename="invoice.xml", data=XML):
    return client.post(
        f"/invoice-batches?project_id={pid}",
        headers=HEADERS,
        files=[("files", (filename, data))],
    )


@pytest.mark.parametrize("xml", [True, False])
def test_background_totals_only_preserves_policy_after_restart(tmp_path, monkeypatch, xml):
    monkeypatch.setattr("api.csv_live.LiveStages.check", lambda *_: pytest.fail("Checker called"))
    if xml:
        monkeypatch.setattr("api.csv_live.LiveStages.extract", lambda *_: pytest.fail("XML model"))
    stages = UploadedMasterStages(model="test", client=FakeClient(completed(invoice())))
    with TestClient(create_app(storage_dir=tmp_path, stages=stages, start_worker=False)) as client:
        login(client)
        pid = project(client, "Expenses")
        response = (
            submit(client, pid)
            if xml
            else submit(client, pid, "invoice.pdf", (DATA / "invoice-01.pdf").read_bytes())
        )
        assert response.status_code == 202, response.text
        receipt = response.json()
        assert receipt["invoices"][0]["project_id"] == pid
        assert receipt["invoices"][0]["comparison_mode"] == "totals_only"
    with TestClient(
        create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    ) as client:
        login(client)
        assert wait_completed(client, receipt["id"])["completed"] == 1
        saved = client.get("/invoices/" + receipt["invoices"][0]["id"]).json()
        assert saved["check"] is None and saved["price_sheet_version"] == ""
        assert saved["project_id"] == pid and saved["comparison_mode"] == "totals_only"
        total = client.get("/projects/" + pid).json()
        assert total["included_count"] == 1 and total["totals"]


def test_background_projects_pin_their_own_master_and_deduplicate_separately(tmp_path):
    stages = UploadedMasterStages(model="test-no-model")
    with TestClient(create_app(storage_dir=tmp_path, stages=stages, start_worker=False)) as client:
        login(client)
        a, b = [project(client, name, "master_list") for name in ("A", "B")]
        assert submit(client, a).status_code == 409
        assert client.get("/invoices").json() == []

        def master(pid, price, replace=False):
            response = (client.put if replace else client.post)(
                f"/master-list?project_id={pid}",
                headers=HEADERS,
                files={"file": ("prices.csv", f"name,price\nDEMO-PART,{price}\n".encode())},
            )
            assert response.is_success, response.text
            return response.json()["version"]

        av, bv = master(a, "10.1250"), master(b, "99")
        first, second = submit(client, a), submit(client, b)
        assert first.status_code == second.status_code == 202
        receipts = [first.json(), second.json()]
        duplicate = submit(client, a).json()
        assert duplicate["invoices"] == [] and len(duplicate["duplicates"]) == 1
        master(a, "77", replace=True)
    with TestClient(create_app(storage_dir=tmp_path, stages=stages)) as client:
        login(client)
        saved = []
        for receipt in receipts:
            assert wait_completed(client, receipt["id"])["completed"] == 1
            saved.append(client.get("/invoices/" + receipt["invoices"][0]["id"]).json())
        assert [row["check"]["price_sheet_version"] for row in saved] == [av, bv]
        assert saved[0]["check"]["lines"][0]["status"] == "match"
        assert saved[1]["check"]["lines"][0]["status"] == "price_mismatch"
        assert len(client.get(f"/invoices?project_id={a}").json()) == 1


def test_approved_accounts_cannot_upload_into_another_accounts_project(tmp_path):
    stages = UploadedMasterStages(model="test-no-model")
    app = create_app(storage_dir=tmp_path, stages=stages, start_worker=False)
    with TestClient(app) as client:
        login(client)
        pid = project(client, "Private expenses")
        member = {"username": "other-member", "password": "other-member-password-2026"}
        assert client.post("/admin/accounts", headers=HEADERS, json=member).status_code == 201
        client.cookies.clear()
        login(client, member)
        assert client.get("/projects").json() == []
        assert client.get("/projects/" + pid).status_code == 404
        assert submit(client, pid).status_code == 404
        assert list(app.state.store.files.iterdir()) == []
