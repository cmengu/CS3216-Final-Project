"""Group summaries must not amplify polling into per-group database reads."""

from contextlib import contextmanager
from uuid import uuid4

from fastapi.testclient import TestClient
from test_live import invoice

from api.app import create_app


def test_group_list_uses_three_queries_and_preserves_private_totals(session_store, monkeypatch):
    store = session_store
    groups = [
        store.create_project(f"Group {i}", "totals_only", session_id="alice") for i in range(12)
    ]
    other = store.create_project("Private group", "totals_only", session_id="bob")

    def add(group, owner, status, currency, amount):
        iid = str(uuid4())
        store.path(iid).write_bytes(b"synthetic invoice")
        store.insert(
            iid, "synthetic.pdf", iid, "live", "", session_id=owner, project_id=group["id"]
        )
        record = invoice().model_copy(update={"currency": currency, "invoice_total": amount})
        store.update(iid, status, invoice=record)

    add(groups[0], "alice", "completed", "USD", "10.01")
    add(groups[0], "alice", "completed", "USD", "0.02")
    add(groups[0], "alice", "completed", "SGD", "20.25")
    add(groups[0], "alice", "reading", "USD", "99")
    add(groups[0], "alice", "completed", None, "99")
    add(groups[0], "alice", "failed", "USD", "99")
    add(other, "bob", "completed", "USD", "999")
    expected = store.project_totals(groups[0]["id"], session_id="alice")
    queries = []
    connect = store.connect

    class TracedConnection:
        def __init__(self, db):
            self.db = db

        def execute(self, query, params=()):
            queries.append(query)
            return self.db.execute(query, params)

    @contextmanager
    def traced_connect():
        with connect() as db:
            yield TracedConnection(db)

    monkeypatch.setattr(store, "connect", traced_connect)
    result = store.list_project_details(session_id="alice")
    assert len(queries) == 3
    assert len(result) == 12
    assert all(group["id"] != other["id"] for group in result)
    actual = next(group for group in result if group["id"] == groups[0]["id"])
    assert {key: actual[key] for key in expected} == expected
    assert actual["totals"] == {"SGD": "20.25", "USD": "10.03"}
    assert actual["invoice_count"] == 5
    assert actual["included_count"] == 3
    assert actual["excluded_count"] == 2
    assert actual["has_master_list"] is False


def test_group_endpoint_has_bounded_queries_with_many_groups(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        store = client.app.state.store
        for index in range(12):
            store.create_project(f"Group {index}", "totals_only", session_id="default")
        queries = []
        connect = store.connect

        @contextmanager
        def traced_connect():
            with connect() as db:
                db.set_trace_callback(queries.append)
                yield db

        monkeypatch.setattr(store, "connect", traced_connect)
        response = client.get("/projects")
        assert response.status_code == 200
        assert len(response.json()) == 12
        assert len([query for query in queries if query.startswith("SELECT")]) == 3
