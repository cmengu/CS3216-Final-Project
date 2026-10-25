"""The Postgres store against a real database. Runs only when DATABASE_URL is set.

Rows are written under random ids and removed afterwards, so the test can share the schema
with a running service.
"""

import os
from uuid import uuid4

import pytest

from api.contracts import CheckResult
from api.storage import MasterListExists, NoMasterList, PostgresStore

URL = os.environ.get("DATABASE_URL", "").strip()
pytestmark = pytest.mark.skipif(not URL, reason="DATABASE_URL is not set")


@pytest.fixture
def store(tmp_path):
    store = PostgresStore(URL, tmp_path)
    ids: list[str] = []
    yield store, ids
    with store.connect() as db:
        db.execute("DELETE FROM invoice_checker.invoices WHERE id = ANY(%s)", (ids,))
        db.execute("DELETE FROM invoice_checker.master_lists WHERE id = ANY(%s)", (ids,))
    store.pool.close()


def test_an_invoice_round_trips_with_its_pdf_and_outcome(store, tmp_path):
    store, ids = store
    invoice_id = str(uuid4())
    ids.append(invoice_id)
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


def test_master_list_versions_keep_their_order_and_state_rules(store):
    store, ids = store
    first, second = str(uuid4()), str(uuid4())
    ids += [first, second]

    def doc(i):
        return {"id": i, "uploadedAt": "2026-10-23T00:00:00+00:00", "items": []}

    with pytest.raises(NoMasterList):
        store.add_master_list(doc(first), {"kind": "replaced"}, b"x", replace=True)
    store.add_master_list(doc(first), {"kind": "uploaded"}, b"x", replace=False)
    with pytest.raises(MasterListExists):
        store.add_master_list(doc(second), {"kind": "uploaded"}, b"y", replace=False)
    store.add_master_list(doc(second), {"kind": "replaced"}, b"y", replace=True)

    assert store.latest_master_list()["id"] == second
    kinds = [e["kind"] for e in store.master_list_events()[:2]]
    assert kinds == ["replaced", "uploaded"]
