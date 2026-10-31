"""The session contract must hold for both persistence implementations after the merge."""

import json
import os
import sqlite3
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.stages import FixtureStages
from api.storage import MasterListExists, NoMasterList, PostgresStore, Store


@pytest.fixture(params=["sqlite", "postgres"])
def session_store(request, tmp_path):
    if request.param == "sqlite":
        yield Store(tmp_path)
        return
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        pytest.skip("DATABASE_URL is not set")
    schema = f"invoice_checker_test_{uuid4().hex}"
    store = PostgresStore(url, tmp_path, schema=schema)
    try:
        yield store
    finally:
        with store.connect() as db:
            db.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        store.pool.close()


def test_invoice_sessions_isolate_reads_lists_and_decisions(session_store):
    store = session_store
    ids = [str(uuid4()), str(uuid4())]
    for sid, invoice_id in zip(("alice", "bob"), ids):
        store.path(invoice_id).write_bytes(b"%PDF-1.4 test")
        store.insert(invoice_id, "sample.pdf", "hash", "fixture", "v1", session_id=sid)
        store.update(invoice_id, "completed")

    assert store.get(ids[0], session_id="bob") is None
    assert store.get(ids[1], session_id="alice") is None
    assert [row.id for row in store.list(10, 0, session_id="alice")] == [ids[0]]
    assert [row.id for row in store.list(10, 0, session_id="bob")] == [ids[1]]
    assert store.list(10, 0, session_id="default") == []

    store.decide(ids[0], "raise_with_supplier", "Wrong session", session_id="bob")
    assert store.get(ids[0], session_id="alice").outcome is None
    store.decide(ids[0], "raise_with_supplier", "Checked", session_id="alice")
    assert store.get(ids[0], session_id="alice").outcome_reason == "Checked"
    assert store.get(ids[1], session_id="bob").outcome is None


def test_master_sessions_isolate_versions_events_and_replacement_state(session_store):
    store = session_store

    def doc(version):
        return {
            "id": str(uuid4()),
            "version": version,
            "uploadedAt": "2026-10-26T00:00:00+00:00",
            "items": [],
        }

    alice, bob, replacement = doc("alice-v1"), doc("bob-v1"), doc("alice-v2")
    store.add_master_list(alice, {"kind": "uploaded"}, b"a", replace=False, session_id="alice")
    assert store.latest_master_list(session_id="bob") is None
    assert store.master_list_version("alice-v1", session_id="bob") is None
    assert store.master_list_events(session_id="bob") == []
    with pytest.raises(NoMasterList):
        store.add_master_list(bob, {}, b"b", replace=True, session_id="bob")
    store.add_master_list(bob, {"kind": "uploaded"}, b"b", replace=False, session_id="bob")
    with pytest.raises(MasterListExists):
        store.add_master_list(replacement, {}, b"r", replace=False, session_id="alice")
    store.add_master_list(replacement, {"kind": "replaced"}, b"r", replace=True, session_id="alice")

    assert store.latest_master_list(session_id="alice") == replacement
    assert store.latest_master_list(session_id="bob") == bob
    assert store.master_list_version("alice-v1", session_id="alice") == alice
    assert store.master_list_version("alice-v2", session_id="bob") is None
    assert [e["kind"] for e in store.master_list_events(session_id="alice")] == [
        "replaced",
        "uploaded",
    ]
    assert store.master_list_events(session_id="bob") == [{"kind": "uploaded"}]
    assert store.latest_master_list() is None


def test_legacy_sqlite_master_migration_preserves_history_and_default_scope(tmp_path):
    # Main's old master_lists has no session column; both old and new rows survive restart.
    old = {"id": "old", "version": "v0", "uploadedAt": "2026-10-23T00:00:00+00:00"}
    with sqlite3.connect(tmp_path / "invoices.sqlite3") as db:
        db.execute(
            "CREATE TABLE master_lists (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, "
            "document TEXT NOT NULL, event TEXT NOT NULL, source BLOB NOT NULL)"
        )
        db.execute(
            "INSERT INTO master_lists VALUES (?,?,?,?,?)",
            (old["id"], old["uploadedAt"], json.dumps(old), '{"kind":"uploaded"}', b"old"),
        )
    store = Store(tmp_path)
    assert store.latest_master_list() == old
    assert store.latest_master_list(session_id="alice") is None
    store.add_master_list(
        {**old, "id": "new", "version": "v1"},
        {"kind": "uploaded"},
        b"new",
        replace=False,
        session_id="alice",
    )
    restarted = Store(tmp_path)
    assert restarted.master_list_version("v0") == old
    assert restarted.latest_master_list(session_id="alice")["version"] == "v1"
    assert restarted.master_list_version("v0", session_id="alice") is None


def test_postgres_app_keeps_outlook_in_a_separate_sqlite_store(tmp_path, monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace

    closed = []
    postgres = SimpleNamespace(
        recover=lambda: None, pool=SimpleNamespace(close=lambda: closed.append(True))
    )
    monkeypatch.setattr("api.app.open_store", lambda directory: postgres)
    monkeypatch.delenv("MICROSOFT_CLIENT_ID", raising=False)
    monkeypatch.delenv("MICROSOFT_CLIENT_SECRET", raising=False)
    data = Path(__file__).resolve().parents[2] / "data/dummy"
    app = create_app(storage_dir=tmp_path, stages=FixtureStages(data))
    with TestClient(app) as client:
        assert app.state.store is postgres
        assert isinstance(app.state.outlook_store, Store)
        response = client.get("/outlook/status")
        assert response.status_code == 200
        assert response.json()["connected"] is False
    assert closed == [True]


def test_revocation_is_isolated_persistent_and_never_shortened(session_store, monkeypatch):
    store = session_store
    now = int(time.time())
    assert not store.is_session_revoked("alice")
    store.revoke_session("alice", now + 3600)
    store.revoke_session("alice", now + 30)
    monkeypatch.setattr("api.storage.time.time", lambda: now + 60)
    assert store.is_session_revoked("alice")
    assert not store.is_session_revoked("bob")
    if isinstance(store, Store):
        assert Store(store.directory).is_session_revoked("alice")
    store.revoke_session("expired", now - 1)
    assert not store.is_session_revoked("expired")
