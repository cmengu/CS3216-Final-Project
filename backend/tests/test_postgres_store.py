"""The Postgres store against a real database. Runs only when DATABASE_URL is set.

Each test gets its own throwaway schema, dropped afterwards, so the test never reads or writes
the live `invoice_checker` schema even when DATABASE_URL points at the running service's
database.
"""

import os
from uuid import uuid4

import pytest

from api.contracts import CheckResult
from api.storage import MasterListExists, NoMasterList, PostgresStore

URL = os.environ.get("DATABASE_URL", "").strip()
needs_db = pytest.mark.skipif(not URL, reason="DATABASE_URL is not set")


@pytest.fixture
def store(tmp_path):
    schema = f"invoice_checker_test_{uuid4().hex[:8]}"
    store = PostgresStore(URL, tmp_path, schema=schema)
    try:
        yield store
    finally:
        with store.connect() as db:
            db.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        store.pool.close()


@pytest.mark.parametrize("schema", ["", "Invoice", "1st", "a-b", "a;DROP SCHEMA x", "a\n"])
def test_only_a_plain_schema_name_is_accepted(schema, tmp_path):
    with pytest.raises(ValueError, match="Invalid Postgres schema name"):
        PostgresStore("postgresql://unused", tmp_path, schema=schema)


@needs_db
def test_an_invoice_round_trips_with_its_pdf_and_outcome(store):
    invoice_id = str(uuid4())
    store.path(invoice_id).write_bytes(b"%PDF-1.4 fake")
    store.insert(invoice_id, "a.pdf", "hash", "live", "v1")

    check = CheckResult(price_sheet_version="v1", lines=[], overcharge_total="0.00", warnings=[])
    store.update(invoice_id, "completed", check=check)
    store.decide(invoice_id, "raise_with_supplier", "Price is wrong")

    saved = store.get(invoice_id)
    assert saved.status == "completed"
    assert saved.check.overcharge_total == "0.00"
    assert saved.outcome == "raise_with_supplier"
    assert saved.decided_at is not None
    assert any(s.id == invoice_id for s in store.list(100, 0))

    # The local file is only a cache: once removed, path() restores it from the database.
    store.path(invoice_id).unlink()
    assert store.path(invoice_id).read_bytes() == b"%PDF-1.4 fake"


@needs_db
def test_master_list_versions_keep_their_order_and_state_rules(store):
    first, second = str(uuid4()), str(uuid4())

    def doc(i):
        return {"id": i, "version": i, "uploadedAt": "2026-10-23T00:00:00+00:00", "items": []}

    with pytest.raises(NoMasterList):
        store.add_master_list(doc(first), {"kind": "replaced"}, b"x", replace=True)
    store.add_master_list(doc(first), {"kind": "uploaded"}, b"x", replace=False)
    with pytest.raises(MasterListExists):
        store.add_master_list(doc(second), {"kind": "uploaded"}, b"y", replace=False)
    store.add_master_list(doc(second), {"kind": "replaced"}, b"y", replace=True)

    assert store.latest_master_list()["id"] == second
    kinds = [e["kind"] for e in store.master_list_events()[:2]]
    assert kinds == ["replaced", "uploaded"]
    assert store.master_list_version(first)["id"] == first
    assert store.master_list_version(second)["id"] == second
    assert store.master_list_version(str(uuid4())) is None
