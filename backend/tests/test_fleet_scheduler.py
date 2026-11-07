"""Independent replicas must share capacity, turns, backlog and storage accounting."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

from api.fleet import Fleet
from api.jobs import InvoiceJobs
from api.limits import UsageLimits
from api.processing import LostLease


def claim_from_process(directory, schema, owner, gate, connection):
    import os

    from api.storage import PostgresStore, Store

    store = (
        PostgresStore(os.environ["DATABASE_URL"], Path(directory), schema=schema)
        if schema
        else Store(Path(directory))
    )
    try:
        UsageLimits(store)
        jobs = InvoiceJobs(store)
        gate.wait(timeout=15)
        connection.send(jobs.claim(owner))
    except Exception as exc:
        connection.send({"error": type(exc).__name__})
    finally:
        connection.close()
        if hasattr(store, "pool"):
            store.pool.close()


def prepare(store, workspace, number, *, limits=None):
    jobs = InvoiceJobs(store)
    documents = []
    for _ in range(number):
        invoice_id = str(uuid4())
        source = b"synthetic immutable source"
        (store.files / f"{invoice_id}.pdf").write_bytes(source)
        documents.append(
            dict(
                id=invoice_id,
                filename="synthetic.xml",
                document_hash=uuid4().hex,
                mode="live",
                size=len(source),
            )
        )
    jobs.enqueue(workspace, documents, "", limits=limits, comparison_mode="totals_only")
    return jobs


def test_twenty_invoice_turns_are_shared_by_independent_schedulers(session_store):
    limits = UsageLimits(session_store)
    first = prepare(session_store, "workspace-a", 45, limits=limits)
    prepare(session_store, "workspace-b", 45, limits=limits)
    prepare(session_store, "workspace-c", 45, limits=limits)
    second = InvoiceJobs(session_store)
    order = []
    for index in range(135):
        jobs = first if index % 2 else second
        job = jobs.claim(f"replica-{index % 2}")
        assert job is not None
        order.append(job["workspace_id"])
        jobs.save(job["invoice_id"], f"replica-{index % 2}", "completed")
    assert order == [
        workspace
        for count in (20, 20, 5)
        for workspace in ("workspace-a", "workspace-b", "workspace-c")
        for _ in range(count)
    ]


def test_time_budget_yields_before_twenty_and_survives_scheduler_restart(
    session_store, monkeypatch
):
    UsageLimits(session_store)
    first = prepare(session_store, "workspace-a", 25)
    prepare(session_store, "workspace-b", 2)
    monkeypatch.setattr(first.fleet, "clock", lambda db: 10000)
    job = first.claim("first")
    assert job["workspace_id"] == "workspace-a"
    first.save(job["invoice_id"], "first", "completed")
    restarted = InvoiceJobs(session_store)
    monkeypatch.setattr(restarted.fleet, "clock", lambda db: 10061)
    assert restarted.claim("restarted")["workspace_id"] == "workspace-b"


def test_simultaneous_replica_claims_cannot_exceed_the_shared_capacity(session_store):
    UsageLimits(session_store)
    first = prepare(session_store, "workspace-a", 4)
    second = prepare(session_store, "workspace-b", 4)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda i: (first if i % 2 else second).claim(f"replica-{i}"), range(8))
        )
    assert sum(job is not None for job in results) == 1


def test_heartbeat_and_completion_do_not_deadlock_or_resurrect_finished_jobs(session_store):
    UsageLimits(session_store)
    jobs = prepare(session_store, "workspace-a", 10)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for _ in range(10):
            job = jobs.claim("replica")
            heartbeat = pool.submit(jobs.heartbeat, job["invoice_id"], "replica")
            complete = pool.submit(jobs.save, job["invoice_id"], "replica", "completed")
            heartbeat.result(timeout=15)
            complete.result(timeout=15)
            assert not jobs.heartbeat(job["invoice_id"], "replica")


def test_expired_heartbeat_does_not_reuse_a_still_running_process_slot(session_store):
    UsageLimits(session_store)
    jobs = prepare(session_store, "workspace-a", 2)
    job = jobs.claim("original")
    with jobs.connect() as db:
        jobs.execute(
            db,
            f"UPDATE {jobs.table('invoice_jobs')} SET lease_until=0 WHERE invoice_id=?",
            (job["invoice_id"],),
        )
        jobs.execute(
            db,
            f"UPDATE {jobs.table('fleet_leases')} SET lease_until=0 WHERE id=?",
            (job["invoice_id"],),
        )
    assert InvoiceJobs(session_store).claim("replacement") is None
    with pytest.raises(LostLease):
        jobs.save(job["invoice_id"], "original", "completed")


def test_higher_capacity_does_not_reclaim_an_unsafe_invoice(session_store, monkeypatch):
    monkeypatch.setenv("INVOICE_FLEET_PROCESSING", "2")
    monkeypatch.setenv("INVOICE_WORKSPACE_PROCESSING", "2")
    UsageLimits(session_store)
    jobs = prepare(session_store, "workspace-a", 3)
    first = jobs.claim("original")
    with jobs.connect() as db:
        jobs.execute(
            db,
            f"UPDATE {jobs.table('invoice_jobs')} SET lease_until=0 WHERE invoice_id=?",
            (first["invoice_id"],),
        )
        jobs.execute(
            db,
            f"UPDATE {jobs.table('fleet_leases')} SET lease_until=0 WHERE id=?",
            (first["invoice_id"],),
        )
    second = jobs.claim("another-replica")
    assert second is not None
    assert second["invoice_id"] != first["invoice_id"]
    assert jobs.claim("third-replica") is None
    with jobs.connect() as db:
        assert (
            jobs.execute(
                db,
                f"SELECT owner FROM {jobs.table('fleet_leases')} WHERE id=?",
                (first["invoice_id"],),
            ).fetchone()["owner"]
            == "original"
        )


def test_capacity_release_is_fenced_by_owner_and_shared_between_replicas(session_store):
    UsageLimits(session_store)
    first, second = Fleet(session_store), Fleet(session_store)
    lease = first.acquire("upload", "workspace-a")
    try:
        second.release(lease.id, "different-owner")
        with pytest.raises(HTTPException) as caught:
            second.acquire("upload", "workspace-b")
        assert caught.value.status_code == 503
    finally:
        lease.close()
    second.acquire("upload", "workspace-b").close()


def test_queue_full_rolls_back_usage_and_does_not_affect_other_workspaces(
    session_store, monkeypatch
):
    monkeypatch.setenv("INVOICE_WORKSPACE_PENDING", "1")
    monkeypatch.setenv("INVOICE_CHECKS_PER_HOUR", "100")
    monkeypatch.setenv("INVOICE_CHECKS_PER_DAY", "100")
    limits = UsageLimits(session_store)
    prepare(session_store, "workspace-a", 1, limits=limits)
    with pytest.raises(HTTPException) as caught:
        prepare(session_store, "workspace-a", 1, limits=limits)
    assert caught.value.status_code == 503
    prepare(session_store, "workspace-b", 1, limits=limits)
    with session_store.connect() as db:
        assert (
            limits.execute(
                db, f"SELECT SUM(used) AS n FROM {limits.table('request_limits')}"
            ).fetchone()["n"]
            == 4
        )


def test_fleet_storage_is_atomic_across_workspace_limits(session_store, monkeypatch):
    limits = UsageLimits(session_store)
    monkeypatch.setenv("INVOICE_FLEET_STORAGE_LIMIT_MB", "1")
    with limits.connect() as db:
        limits.reserve_storage("workspace-a", 700000, maximum=1048576, db=db)
    with pytest.raises(HTTPException) as caught:
        limits.reserve_storage("workspace-b", 700000, maximum=1048576)
    assert caught.value.status_code == 413
    with limits.connect() as db:
        assert (
            limits.execute(
                db, f"SELECT reserved FROM {limits.table('fleet_storage')} WHERE id='main'"
            ).fetchone()["reserved"]
            == 700000
        )
    limits.release_storage("workspace-a", 700000)
    limits.reserve_storage("workspace-b", 700000, maximum=1048576)


def test_replicas_cannot_silently_disagree_about_shared_limits(session_store, monkeypatch):
    Fleet(session_store)
    monkeypatch.setenv("INVOICE_FLEET_PROCESSING", "5")
    paused = Fleet(session_store)
    assert not paused.enabled
    with pytest.raises(HTTPException) as caught:
        paused.acquire("upload", "workspace-a")
    assert caught.value.status_code == 503
    assert "Saved invoices remain available" in caught.value.detail


def test_separate_server_processes_share_the_same_processing_slot(session_store):
    import multiprocessing

    UsageLimits(session_store)
    prepare(session_store, "workspace-a", 4)
    prepare(session_store, "workspace-b", 4)
    context = multiprocessing.get_context("spawn")
    gate = context.Barrier(3)
    processes, readers = [], []
    try:
        for index in range(2):
            parent, child = context.Pipe(duplex=False)
            process = context.Process(
                target=claim_from_process,
                args=(
                    str(session_store.directory),
                    getattr(session_store, "schema", None),
                    f"replica-{index}",
                    gate,
                    child,
                ),
            )
            process.start()
            child.close()
            readers.append(parent)
            processes.append(process)
        gate.wait(timeout=15)
        answers = []
        for connection in readers:
            assert connection.poll(15)
            answers.append(connection.recv())
        assert all(answer is None or "error" not in answer for answer in answers), answers
        assert sum(answer is not None for answer in answers) == 1
    finally:
        for process in processes:
            process.join(timeout=5)
            if process.is_alive():
                process.kill()
                process.join(timeout=5)
        for connection in readers:
            connection.close()


def test_three_workspaces_with_500_invoices_each_get_twenty_at_a_time(session_store, monkeypatch):
    UsageLimits(session_store)
    jobs = prepare(session_store, "workspace-a", 500)
    prepare(session_store, "workspace-b", 500)
    prepare(session_store, "workspace-c", 500)
    monkeypatch.setattr(jobs.fleet, "clock", lambda db: 10000)
    for turn in range(75):
        expected = ("workspace-a", "workspace-b", "workspace-c")[turn % 3]
        for _ in range(20):
            job = jobs.claim("replica")
            assert job["workspace_id"] == expected
            jobs.save(job["invoice_id"], "replica", "completed")
    assert jobs.claim("replica") is None


def test_failed_termination_quarantines_capacity_instead_of_reusing_it(session_store):
    from types import SimpleNamespace

    from test_api import lightweight_reader

    from api.jobs import InvoiceWorker
    from api.uploaded_master import UploadedMasterStages

    class UnsafeExecutor:
        safe_to_release = False

        def execute(self, *args, **kwargs):
            raise RuntimeError("Synthetic failure to terminate")

    UsageLimits(session_store)
    jobs = prepare(session_store, "workspace-a", 2)
    app = SimpleNamespace(
        state=SimpleNamespace(
            jobs=jobs,
            store=session_store,
            stages=UploadedMasterStages(model="unused"),
            reader=lightweight_reader,
            executor=UnsafeExecutor(),
        )
    )
    worker = InvoiceWorker(app)
    job = jobs.claim(worker.owner)
    worker.process(job)
    with jobs.connect() as db:
        row = jobs.execute(
            db,
            f"SELECT safe_until FROM {jobs.table('fleet_leases')} WHERE id=?",
            (job["invoice_id"],),
        ).fetchone()
        assert row["safe_until"] == 9223372036854775807
    assert jobs.claim("another-replica") is None
