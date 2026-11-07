"""Rejected work must not exhaust allowances or block later valid uploads."""

import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from pathlib import Path
from threading import Barrier, Event

import httpx
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from psycopg import InterfaceError, OperationalError
from psycopg.errors import ReadOnlySqlTransaction
from psycopg_pool import PoolTimeout, TooManyRequests
from test_xml_invoice import XML

from api.app import create_app
from api.jobs import InvoiceWorker
from api.storage import PostgresStore, StorageUnavailable
from api.uploaded_master import UploadedMasterStages

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "0")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = create_app(
        storage_dir=tmp_path, stages=UploadedMasterStages(model="unused"), start_worker=False
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        project = client.post(
            "/projects", json={"name": "Synthetic limits", "comparison_mode": "totals_only"}
        ).json()
        yield app, client, project["id"]


def usage(app):
    with app.state.store.connect() as db:
        return db.execute("SELECT COALESCE(SUM(used),0) FROM request_limits").fetchone()[0]


def test_daily_check_quotas_are_disabled_by_default(service):
    app, client, pid = service
    assert upload(client, pid).status_code == 202
    assert usage(app) == 0


def test_optional_check_quotas_accept_explicit_zero(monkeypatch):
    from api.limits import invoice_allowances

    for name in ("INVOICE_CHECKS_PER_HOUR", "INVOICE_CHECKS_PER_DAY", "INVOICE_AI_CHECKS_PER_DAY"):
        monkeypatch.setenv(name, "0")
    assert invoice_allowances("workspace", 500, 500) == []


def test_full_queue_is_checked_before_parsing_or_validating_another_batch(service, monkeypatch):
    from test_fleet_scheduler import prepare

    app, client, pid = service
    prepare(app.state.store, "default", 500, limits=app.state.limits)
    response = client.head("/invoice-batches", params={"project_id": pid})
    assert response.status_code == 204
    assert response.headers["X-Invoice-Batch-Limit"] == "0"
    monkeypatch.setattr(
        "api.batches.validate_pdf",
        lambda *_: pytest.fail("Full queues must reject before PDF validation"),
    )
    refused = client.post(
        "/invoice-batches",
        params={"project_id": pid},
        headers={"X-Invoice-Batch-Count": "1"},
        files=[("files", ("new.pdf", b"not even parsed", "application/pdf"))],
    )
    assert refused.status_code == 503
    assert refused.headers["Retry-After"] == "30"
    assert refused.headers["X-Invoice-Batch-Limit"] == "0"
    assert client.get("/health").status_code == 200


def test_partial_queue_space_is_reported_without_sending_large_bodies(service):
    from test_fleet_scheduler import prepare

    app, client, pid = service
    prepare(app.state.store, "default", 495, limits=app.state.limits)
    available = client.head("/invoice-batches", params={"project_id": pid})
    assert available.headers["X-Invoice-Batch-Limit"] == "5"
    refused = client.post(
        "/invoice-batches",
        params={"project_id": pid},
        headers={"X-Invoice-Batch-Count": "500"},
        content=b"not parsed",
    )
    assert refused.status_code == 503
    assert refused.headers["X-Invoice-Batch-Limit"] == "5"


def test_capacity_configuration_mismatch_preserves_reads_and_sign_in(service, monkeypatch):
    app, client, _ = service
    monkeypatch.setenv("INVOICE_FLEET_PROCESSING", "2")
    other = create_app(
        storage_dir=app.state.store.directory,
        stages=UploadedMasterStages(model="unused"),
        start_worker=False,
    )
    with TestClient(other) as readable:
        assert not other.state.fleet.enabled
        assert readable.get("/health").status_code == 200
        assert readable.get("/invoices").status_code == 200
        assert readable.get("/auth/me").status_code == 401  # Unauthenticated, not unavailable.
        assert (
            readable.post(
                "/auth/sign-in",
                json={"username": "unknown", "password": "invalid-password"},
                headers={"Origin": "http://localhost:3000", "X-Requested-With": "InvoiceChecker"},
            ).status_code
            == 401
        )
        assert readable.head("/invoice-batches").status_code == 503


def test_supabase_database_growth_budget_includes_existing_database_data():
    store = object.__new__(PostgresStore)
    store.schema = "synthetic"
    store.database_budget_bytes = 400 * 1024 * 1024

    class Database:
        def execute(self, query, *args):
            self.query = query
            return self

        def fetchone(self):
            return (
                {"bytes": 399 * 1024 * 1024}
                if "pg_database_size" in self.query
                else {"reserved": 1}
            )

    db = Database()
    store.check_growth(db, 1024)
    with pytest.raises(HTTPException) as caught:
        store.check_growth(db, 2 * 1024 * 1024)
    assert caught.value.status_code == 413
    assert "database storage budget" in caught.value.detail
    # Error/status-only writes remain possible to explain a capacity failure.
    store.check_growth(db, 0)


def test_supabase_free_profile_uses_database_budget_not_object_storage(tmp_path, monkeypatch):
    class Database:
        def execute(self, *args, **kwargs):
            return self

    class Pool:
        def __init__(self, *args, **kwargs):
            pass

        @contextmanager
        def connection(self):
            yield Database()

    monkeypatch.setattr("psycopg_pool.ConnectionPool", Pool)
    store = PostgresStore(
        "postgresql://synthetic:unused@db.synthetic.supabase.co/postgres", tmp_path
    )
    assert store.storage_profile == "supabase_free"
    assert store.source_budget_default_mb == 400
    assert store.database_budget_bytes == 400 * 1024 * 1024


def upload(client, pid, names=("invoice-01.pdf",)):
    return client.post(
        "/invoice-batches",
        params={"project_id": pid},
        files=[("files", (name, (DATA / name).read_bytes(), "application/pdf")) for name in names],
    )


def test_later_quota_rejection_does_not_consume_other_allowances(service, monkeypatch):
    app, client, pid = service
    monkeypatch.setenv("INVOICE_CHECKS_PER_HOUR", "2")
    monkeypatch.setenv("INVOICE_AI_CHECKS_PER_DAY", "1")
    refused = upload(client, pid, ("invoice-01.pdf", "invoice-02.pdf"))
    assert refused.status_code == 429
    assert usage(app) == 0
    assert refused.headers.get("X-Invoice-Batch-Limit") == "1"
    assert upload(client, pid).status_code == 202


def test_storage_rejection_does_not_consume_checks(service, monkeypatch):
    app, client, pid = service
    monkeypatch.setenv("INVOICE_STORAGE_LIMIT_MB", "1")
    refused = client.post(
        "/invoice-batches",
        params={"project_id": pid},
        files=[("files", ("synthetic.xml", XML + b" " * (1024 * 1024), "application/xml"))],
    )
    assert refused.status_code == 413
    assert usage(app) == 0
    assert upload(client, pid).status_code == 202


def test_database_failure_rolls_back_checks_and_storage(service):
    app, client, pid = service
    with app.state.store.connect() as db:
        db.execute(
            "CREATE TRIGGER reject_job BEFORE INSERT ON invoice_jobs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
        )
    assert upload(client, pid).status_code == 500
    assert usage(app) == 0
    with app.state.store.connect() as db:
        assert db.execute("SELECT COALESCE(SUM(reserved),0) FROM storage_limits").fetchone()[0] == 0
    assert client.get("/invoices").json() == []


def test_racing_duplicates_do_not_exhaust_the_checking_allowance(service, monkeypatch):
    app, client, pid = service
    monkeypatch.setenv("INVOICE_CHECKS_PER_HOUR", "1")
    existing = app.state.jobs.existing_many
    barrier = Barrier(2)

    def synchronized(*args, **kwargs):
        result = existing(*args, **kwargs)
        barrier.wait(timeout=5)
        return result

    monkeypatch.setattr(app.state.jobs, "existing_many", synchronized)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: upload(client, pid), range(2)))
    replies = [
        upload(client, pid) if response.status_code == 503 else response for response in replies
    ]
    assert [response.status_code for response in replies] == [202, 202]
    assert sum(len(response.json()["invoices"]) for response in replies) == 1
    assert sum(len(response.json()["duplicates"]) for response in replies) == 1


def test_invalid_immediate_invoice_does_not_consume_checks(service):
    app, client, pid = service
    response = client.post(
        "/invoices",
        params={"project_id": pid},
        files={"file": ("invalid.pdf", b"invalid", "application/pdf")},
    )
    assert response.status_code == 422
    assert usage(app) == 0


def test_retry_headers_are_exposed_to_the_local_browser(service, monkeypatch):
    _, client, pid = service
    monkeypatch.setenv("INVOICE_AI_CHECKS_PER_DAY", "1")
    response = client.post(
        "/invoice-batches",
        params={"project_id": pid},
        headers={"Origin": "http://localhost:3000"},
        files=[
            ("files", (name, (DATA / name).read_bytes(), "application/pdf"))
            for name in ("invoice-01.pdf", "invoice-02.pdf")
        ],
    )
    assert response.status_code == 429
    exposed = response.headers.get("access-control-expose-headers", "").lower()
    assert "retry-after" in exposed
    assert "x-invoice-batch-limit" in exposed


@pytest.mark.parametrize(
    "failure",
    [PoolTimeout, TooManyRequests, OperationalError, InterfaceError, ReadOnlySqlTransaction],
)
def test_database_pool_exhaustion_is_safe_and_retryable(failure):
    class FailedPool:
        @contextmanager
        def connection(self):
            raise failure("private connection information")
            yield

    store = object.__new__(PostgresStore)
    store.pool = FailedPool()
    with pytest.raises(StorageUnavailable) as caught:
        with store.connect():
            pass
    assert "private" not in str(caught.value)


def test_database_outage_returns_retryable_503(service, monkeypatch):
    app, client, _ = service

    def unavailable(*args, **kwargs):
        raise StorageUnavailable("private database information")

    monkeypatch.setattr(app.state.store, "list", unavailable)
    response = client.get("/invoices")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    assert "private" not in response.text
    assert client.get("/health").status_code == 200


def test_auth_database_outage_is_also_retryable(service, monkeypatch):
    _, client, _ = service

    def unavailable(request):
        raise StorageUnavailable("private database information")

    monkeypatch.setattr("api.app._protected_auth_error", unavailable)
    response = client.get("/invoices")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    assert "private" not in response.text


def test_postgres_sources_are_published_atomically(tmp_path, monkeypatch):
    from api import storage

    store = object.__new__(PostgresStore)
    store.schema = "synthetic"
    store.files = tmp_path
    source = b"synthetic immutable source" * 100

    class Database:
        def execute(self, *args):
            return self

        def fetchone(self):
            return {"content": source}

    @contextmanager
    def connection():
        yield Database()

    monkeypatch.setattr(store, "connect", connection)
    replace = storage.os.replace
    publications = []

    def publish(temporary, destination):
        assert temporary.read_bytes() == source
        assert not destination.exists()
        publications.append(destination)
        return replace(temporary, destination)

    monkeypatch.setattr(storage.os, "replace", publish)
    assert store.path("synthetic").read_bytes() == source
    assert publications == [tmp_path / "synthetic.pdf"]
    assert list(tmp_path.glob("*.tmp")) == []


def test_only_one_batch_is_admitted_at_a_time(service, monkeypatch):
    _, client, pid = service
    entered, released = Event(), Event()
    from api import batches

    validate = batches.validate_pdf

    def slow_validation(path):
        entered.set()
        assert released.wait(5)
        return validate(path)

    monkeypatch.setattr(batches, "validate_pdf", slow_validation)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(upload, client, pid)
        try:
            assert entered.wait(3)
            second = upload(client, pid)
            assert second.status_code == 503
            assert second.headers["Retry-After"] == "5"
            assert client.get("/health").status_code == 200
        finally:
            released.set()
        assert first.result().status_code == 202


def test_streamed_body_without_content_length_is_bounded(service):
    app, _, _ = service

    @app.post("/auth/size-probe")
    async def size_probe(request: Request):
        return {"size": len(await request.body())}

    async def stream():
        yield b"x" * 9000
        yield b"x" * 9000

    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://testserver"
        ) as client:
            return await client.post("/auth/size-probe", content=stream())

    assert asyncio.run(send()).status_code == 413


def test_ten_workspaces_share_upload_admission_but_not_quota_or_documents(service, monkeypatch):
    app, client, _ = service
    monkeypatch.setenv("INVOICE_CHECKS_PER_HOUR", "1")
    monkeypatch.setenv("INVOICE_CHECKS_PER_DAY", "1")
    workspaces = [f"synthetic-workspace-{index}" for index in range(10)]
    headers = [{"X-Invoice-Session": workspace} for workspace in workspaces]
    projects = []
    for index, identity in enumerate(headers):
        response = client.post(
            "/projects",
            headers=identity,
            json={"name": f"Workspace {index}", "comparison_mode": "totals_only"},
        )
        assert response.status_code == 201, response.text
        projects.append(response.json()["id"])

    from api import batches

    entered, released = Event(), Event()
    barrier = Barrier(10)
    read = batches.read_xml_invoice

    def blocked_read(*args, **kwargs):
        entered.set()
        assert released.wait(10)
        return read(*args, **kwargs)

    def submit(index, simultaneous=False):
        if simultaneous:
            barrier.wait(timeout=10)
        return client.post(
            "/invoice-batches",
            headers=headers[index],
            params={"project_id": projects[index]},
            files=[("files", ("same-content.xml", XML, "application/xml"))],
        )

    monkeypatch.setattr(batches, "read_xml_invoice", blocked_read)
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(submit, index, True): index for index in range(10)}
        replies = {}
        try:
            assert entered.wait(5)
            finished = as_completed(futures, timeout=5)
            for _ in range(9):
                future = next(finished)
                response = future.result()
                assert response.status_code == 503, response.text
                assert response.headers["Retry-After"] == "5"
                replies[futures[future]] = response
            assert client.get("/health").status_code == 200
            assert usage(app) == 0
        finally:
            released.set()
        for future, index in futures.items():
            replies[index] = future.result()

    assert sum(response.status_code == 202 for response in replies.values()) == 1
    assert sum(response.status_code == 503 for response in replies.values()) == 9
    for index, response in replies.items():
        if response.status_code == 503:
            replies[index] = submit(index)
        assert replies[index].status_code == 202, replies[index].text
        assert len(replies[index].json()["invoices"]) == 1
        assert replies[index].json()["duplicates"] == []

    assert usage(app) == 20  # One hourly and one daily charge for each workspace.
    worker = InvoiceWorker(app)
    claimed = []
    while job := app.state.jobs.claim(worker.owner):
        claimed.append(job["workspace_id"])
        worker.process(job)
    assert sorted(claimed) == sorted(workspaces)
    for index, identity in enumerate(headers):
        response = client.get("/invoices", headers=identity)
        rows = response.json()
        assert len(rows) == 1
        assert rows[0]["status"] == "completed"
        assert rows[0]["project_id"] == projects[index]
        other_batch = replies[(index + 1) % 10].json()["id"]
        assert client.get(f"/invoice-batches/{other_batch}", headers=identity).status_code == 404
