from fastapi.testclient import TestClient
from test_api import DATA, lightweight_reader

from api.app import create_app
from api.contracts import CheckResult
from api.stages import FixtureStages
from schema import InvoiceRecord


def test_reprocess_replaces_results_without_creating_invoice(tmp_path):
    stages = FixtureStages(DATA)
    app = create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    with TestClient(app) as client:
        original = client.post(
            "/invoices",
            files={
                "file": ("invoice.pdf", (DATA / "invoice-02.pdf").read_bytes(), "application/pdf")
            },
        ).json()
        iid = original["id"]
        stages.extract = lambda doc: InvoiceRecord.model_validate(original["invoice"]).model_copy(
            update={"supplier_name": "Refreshed supplier"}
        )
        stages.check = lambda record: CheckResult.model_validate(original["check"])
        result = client.post(f"/invoices/{iid}/reprocess")
        assert result.status_code == 200, result.text
        assert result.json()["id"] == iid
        assert result.json()["invoice"]["supplier_name"] == "Refreshed supplier"
        assert len(client.get("/invoices").json()) == 1
        assert (
            client.get(f"/invoices/{iid}").json()["invoice"]["supplier_name"]
            == "Refreshed supplier"
        )
        assert client.get(f"/invoices/{iid}/file").content == (DATA / "invoice-02.pdf").read_bytes()

        def fail(doc):
            raise ValueError("test reader failed")

        stages.extract = fail
        failed = client.post(f"/invoices/{iid}/reprocess")
        assert failed.status_code == 422
        assert failed.json()["id"] == iid
        assert failed.json()["invoice"] is None
        assert failed.json()["check"] is None
        assert len(client.get("/invoices").json()) == 1


def test_reprocess_cannot_restart_active_invoice(tmp_path):
    stages = FixtureStages(DATA)
    app = create_app(storage_dir=tmp_path, stages=stages, reader=lightweight_reader)
    with TestClient(app) as client:
        original = client.post(
            "/invoices",
            files={
                "file": ("invoice.pdf", (DATA / "invoice-02.pdf").read_bytes(), "application/pdf")
            },
        ).json()
        app.state.store.update(original["id"], "extracting")
        result = client.post(f"/invoices/{original['id']}/reprocess")
        assert result.status_code == 409
        assert client.get(f"/invoices/{original['id']}").json()["status"] == "extracting"
