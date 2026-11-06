"""Slow authentication database calls must not block unrelated HTTP requests."""

import asyncio
import threading

import httpx
import pytest
from fastapi.testclient import TestClient
from test_accounts import ADMIN, DATA

from api.app import create_app
from api.stages import FixtureStages


@pytest.mark.parametrize("operation", ["session", "rate_limit"])
def test_slow_auth_database_does_not_block_health(tmp_path, monkeypatch, operation):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), start_worker=False)
    entered, release, timed_out = threading.Event(), threading.Event(), threading.Event()

    def wait_for_health():
        entered.set()
        if not release.wait(3):
            timed_out.set()

    with TestClient(app):
        if operation == "session":
            from api.app import has_invalid_auth_token

            def slow_session(request):
                wait_for_health()
                return has_invalid_auth_token(request)

            monkeypatch.setattr("api.app.has_invalid_auth_token", slow_session)
        else:
            take = app.state.limits.take

            def slow_limit(scope, *args, **kwargs):
                if scope == "login-ip":
                    wait_for_health()
                return take(scope, *args, **kwargs)

            monkeypatch.setattr(app.state.limits, "take", slow_limit)

        async def concurrent_requests():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                blocked = asyncio.create_task(
                    client.get("/invoices")
                    if operation == "session"
                    else client.post(
                        "/auth/sign-in",
                        json={"username": "unknown", "password": "invalid"},
                        headers={"X-Requested-With": "InvoiceChecker"},
                    )
                )
                try:
                    assert await asyncio.to_thread(entered.wait, 2)
                    response = await asyncio.wait_for(client.get("/health"), 1)
                    assert response.status_code == 200
                    assert not timed_out.is_set(), "A database wait blocked all other requests"
                finally:
                    release.set()
                    response = await blocked
                assert response.status_code == 401

        asyncio.run(concurrent_requests())
