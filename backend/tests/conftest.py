import os
from uuid import uuid4

import pytest

from api.storage import PostgresStore, Store


def pytest_addoption(parser):
    parser.addoption("--run-docling", action="store_true", help="Run model-backed PDF/OCR tests")
    parser.addoption(
        "--run-model",
        action="store_true",
        help="Run the real OpenAI extraction against data/dummy only",
    )


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--run-docling"):
        for item in items:
            if "docling" in item.keywords:
                item.add_marker(
                    pytest.mark.skip(reason="Pass --run-docling to download/run models")
                )
    if not config.getoption("--run-model"):
        for item in items:
            if "model" in item.keywords:
                item.add_marker(
                    pytest.mark.skip(reason="Pass --run-model to call OpenAI on data/dummy")
                )


@pytest.fixture(autouse=True)
def isolated_auth_secret(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", "isolated-automated-test-signing-secret-2026")


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
