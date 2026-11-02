"""Access control and durable queue contracts for both database implementations."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from api.accounts import Accounts
from api.jobs import InvoiceJobs
from api.limits import UsageLimits
from api.processing import LostLease


def test_registered_private_sessions_and_resets(session_store):
    accounts = Accounts(session_store)
    first = accounts.create_user("first-member", "a-private-password-2026", "member")
    second = accounts.create_user("second-member", "another-private-password-2026", "admin")
    assert first["workspace_id"] != second["workspace_id"]
    sid, expiry = accounts.create_session(first, 3600)
    assert (
        accounts.session_claims(sid, first["username"], expiry)["workspace_id"]
        == first["workspace_id"]
    )
    accounts.update_user(first["id"], actor=second["id"], password="a-replacement-password-2026")
    assert accounts.session_claims(sid, first["username"], expiry) is None
    assert accounts.authenticate(first["username"], "a-private-password-2026") is None
    assert (
        accounts.authenticate(first["username"], "a-replacement-password-2026")["workspace_id"]
        == first["workspace_id"]
    )


def test_quota_reservations_and_rate_windows_are_atomic_and_persistent(session_store):
    limits = UsageLimits(session_store)

    def attempt(_):
        try:
            limits.take("parallel", "private-account", maximum=1, seconds=3600)
            return True
        except HTTPException as exc:
            assert exc.status_code == 429
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(attempt, range(4))).count(True) == 1
    with pytest.raises(HTTPException):
        UsageLimits(session_store).take("parallel", "private-account", maximum=1, seconds=3600)
    limits.reserve_storage("private-account", 10, maximum=10)
    with pytest.raises(HTTPException):
        limits.reserve_storage("private-account", 1, maximum=10)
    limits.release_storage("private-account", 4)
    limits.reserve_storage("private-account", 4, maximum=10)
    with pytest.raises(HTTPException):
        limits.reserve_storage("new-account", 11, maximum=10)


def test_jobs_are_durable_private_and_reject_stale_writes(session_store):
    store = session_store
    UsageLimits(store).reserve_storage("first-account", 4, maximum=100)
    jobs = InvoiceJobs(store)
    invoice_id = "11111111-1111-1111-1111-111111111111"
    store.path(invoice_id).write_bytes(b"test")
    batch, accepted, duplicates = jobs.enqueue(
        "first-account",
        [
            {
                "id": invoice_id,
                "filename": "synthetic.pdf",
                "document_hash": "test-hash",
                "mode": "fixture",
                "size": 4,
            }
        ],
        "v1",
    )
    assert accepted == [invoice_id] and duplicates == []
    store.recover()
    assert store.get(invoice_id, session_id="first-account").status == "queued"
    assert jobs.batch(batch, "second-account") is None
    claimed = jobs.claim("owning-worker")
    assert claimed["invoice_id"] == invoice_id
    assert jobs.claim("different-worker") is None
    with pytest.raises(LostLease):
        jobs.save(invoice_id, "different-worker", "failed", error="reading: test")
    jobs.save(invoice_id, "owning-worker", "failed", error="reading: synthetic failure")
    assert jobs.batch(batch, "first-account")["failed"] == 1
