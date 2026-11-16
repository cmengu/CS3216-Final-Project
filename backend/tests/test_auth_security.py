"""Browser request, OAuth binding and persistent logout regression tests."""

import time
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import COOKIE_NAME, create_session_token, verify_session_token
from api.outlook import OAUTH_BROWSER_COOKIE, STATE_TTL_SECONDS

CSRF = {"X-Requested-With": "InvoiceChecker"}
TRUSTED = {**CSRF, "Origin": "http://localhost:3000"}
LOGIN = {"username": "security-test", "password": "isolated-test-password"}


@pytest.fixture
def secure_app(tmp_path, monkeypatch):
    for key, value in {
        "AUTH_REQUIRED": "1",
        "AUTH_SECRET": "isolated-regression-test-secret-with-32-characters",
        "AUTH_USERNAME": LOGIN["username"],
        "AUTH_PASSWORD": LOGIN["password"],
        "MICROSOFT_CLIENT_ID": "test-client",
        "MICROSOFT_CLIENT_SECRET": "test-provider-secret",
        "FRONTEND_URL": "http://localhost:3000",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("INVOICE_ALLOWED_ORIGIN_REGEX", raising=False)
    return create_app(storage_dir=tmp_path)


def login(client):
    response = client.post("/auth/sign-in", json=LOGIN, headers=TRUSTED)
    assert response.status_code == 200
    return response.json()["session_id"]


def start_outlook(client):
    response = client.get("/auth/outlook/login", follow_redirects=False)
    assert response.status_code == 302
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0], response


def callback(client, state):
    return client.get(
        "/auth/outlook/callback",
        params={"state": state, "code": "test-code"},
        follow_redirects=False,
    )


@pytest.fixture
def provider(monkeypatch):
    exchange = Mock(
        return_value={
            "access_token": "test-access",
            "refresh_token": "test-refresh",
            "expires_in": 3600,
        }
    )
    monkeypatch.setattr("api.outlook._exchange_code_for_tokens", exchange)
    monkeypatch.setattr(
        "api.outlook._fetch_graph_profile", lambda token: {"mail": "test@example.invalid"}
    )
    return exchange


@pytest.mark.parametrize("authenticated", [False, True])
def test_api_documentation_is_unavailable_even_after_sign_in(secure_app, authenticated):
    with TestClient(secure_app) as client:
        if authenticated:
            login(client)
        assert client.get("/health").status_code == 200
        assert client.get("/invoices").status_code == (200 if authenticated else 401)
        # Vercel strips /api before forwarding these same paths to the backend.
        for path in ("/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"):
            for suffix in ("", "/", "?probe=1"):
                for method in ("GET", "HEAD", "POST", "OPTIONS"):
                    response = client.request(method, path + suffix, follow_redirects=False)
                    assert response.status_code == 404, (method, path + suffix, response.text)
                    if method != "HEAD":
                        assert response.json() == {"detail": "Not Found"}


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/future-private"),
        ("GET", "/auth/setup/future-private"),
        ("GET", "/health/future-private"),
        ("GET", "/auth/sign-in"),
        ("OPTIONS", "/future-private"),
    ],
)
def test_new_routes_require_authentication_by_default(secure_app, method, path):
    called = []

    @secure_app.api_route(path, methods=[method])
    def private_route():
        called.append(True)
        return {"private": True}

    with TestClient(secure_app) as client:
        for suffix in ("", "/", "?probe=1"):
            response = client.request(method, path + suffix, follow_redirects=False)
            assert response.status_code == 401
            assert response.headers["Cache-Control"] == "no-store"
        assert called == []
        login(client)
        response = client.request(method, path)
        assert response.json() == {"private": True}
        assert response.headers["Cache-Control"] == "no-store"
        assert called == [True]


def test_query_credentials_cannot_authenticate_and_cookies_and_headers_still_work(secure_app):
    with TestClient(secure_app) as client:
        token = login(client)
        owner = client.get("/auth/me").json()["user"]["id"]
        invoice_id = "11111111-1111-4111-8111-111111111111"
        store = secure_app.state.store
        store.insert(invoice_id, "private.pdf", "private-hash", "fixture", "v1", session_id=owner)
        store.update(invoice_id, "failed", error="reading: synthetic")
        store.path(invoice_id).write_bytes(b"%PDF-1.4 synthetic")
        paths = [
            ("/invoices", 200),
            (f"/invoices/{invoice_id}", 200),
            (f"/invoices/{invoice_id}/file", 200),
            ("/auth/me", 200),
            ("/admin/accounts", 200),
            ("/auth/outlook/login", 302),
        ]
        # A URL parameter cannot override an existing authenticated browser session.
        assert (
            client.get("/invoices", params={"session_id": "ic1.invalid.token"}).status_code == 200
        )
        client.cookies.clear()
        for path, _ in paths:
            response = client.get(path, params={"session_id": token}, follow_redirects=False)
            assert response.status_code == 401, path
        for headers in (
            {"Authorization": f"Bearer {token}"},
            {"X-Invoice-Session": token},
            {"Cookie": f"{COOKIE_NAME}={token}"},
        ):
            for path, status in paths:
                response = client.get(path, headers=headers, follow_redirects=False)
                assert response.status_code == status, path
        # Trusted CORS preflight never authorizes the following operation.
        preflight = client.options(
            "/invoices",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
        )
        assert preflight.status_code == 200
        assert client.get("/invoices").status_code == 401


@pytest.mark.parametrize("path", ["/auth/sign-in", "/auth/sign-out"])
def test_auth_mutations_require_header_even_without_cookie(secure_app, path):
    with TestClient(secure_app) as client:
        assert (
            client.post(path, json=LOGIN, headers={"Origin": "http://localhost:3000"}).status_code
            == 403
        )
        assert (
            client.post(
                path, json=LOGIN, headers={**CSRF, "Origin": "https://attacker.invalid"}
            ).status_code
            == 403
        )
        assert client.post(path, json=LOGIN, headers={**CSRF, "Origin": "null"}).status_code == 403
        assert client.post(path, json=LOGIN, headers=TRUSTED).status_code == 200


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/master-list"),
        ("PUT", "/master-list"),
        ("POST", "/invoices"),
        ("PUT", "/invoices/anything/outcome"),
        ("POST", "/outlook/disconnect"),
        ("POST", "/outlook/scan"),
    ],
)
def test_cookie_mutations_block_cross_site_forms_and_untrusted_ajax(secure_app, method, path):
    with TestClient(secure_app) as client:
        login(client)
        assert (
            client.request(
                method,
                path,
                data={"untrusted": "form"},
                headers={"Origin": "https://attacker.invalid"},
            ).status_code
            == 403
        )
        assert (
            client.request(
                method, path, headers={**CSRF, "Origin": "https://attacker.invalid"}
            ).status_code
            == 403
        )
        assert (
            client.request(method, path, headers={"Origin": "http://localhost:3000"}).status_code
            == 403
        )
        assert client.request(method, path, headers=TRUSTED).status_code != 403
        assert client.get("/invoices").status_code == 200


def test_multipart_and_trusted_preflight_and_explicit_api_credentials(secure_app):
    with TestClient(secure_app) as client:
        token = login(client)
        # A browser can submit multipart without a preflight: the server must reject it.
        response = client.post(
            "/master-list",
            files={"file": ("prices.csv", b"sku,price\na,1")},
            headers={"Origin": "https://attacker.invalid"},
        )
        assert response.status_code == 403
        for origin, status in [("http://localhost:3000", 200), ("https://attacker.invalid", 400)]:
            preflight = client.options(
                "/invoices",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "X-Requested-With",
                },
            )
            assert preflight.status_code == status
        client.cookies.clear()
        # Explicit bearer credentials are not ambient browser cookies.
        assert (
            client.post(
                "/outlook/disconnect", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 200
        )


def test_logout_revokes_every_token_transport_and_survives_restart(secure_app, tmp_path):
    with TestClient(secure_app) as client:
        token = login(client)
        claims = verify_session_token(token)
        another_token = create_session_token(
            claims["username"], claims["session_id"], ttl_seconds=60
        )
        assert client.post("/auth/sign-out", headers=TRUSTED).status_code == 200
        assert client.cookies.get(COOKIE_NAME) is None
        for replay in [token, another_token]:
            for headers, params in [
                ({"Cookie": f"{COOKIE_NAME}={replay}"}, {}),
                ({"Authorization": f"Bearer {replay}"}, {}),
                ({"X-Invoice-Session": replay}, {}),
                ({}, {"session_id": replay}),
            ]:
                assert client.get("/invoices", headers=headers, params=params).status_code == 401
                assert client.get("/auth/me", headers=headers, params=params).status_code == 401
        # Logout remains safe to repeat after the cookie is already cleared.
        assert client.post("/auth/sign-out", headers=TRUSTED).status_code == 200
        login(client)
        assert client.get("/invoices").status_code == 200
    with TestClient(create_app(storage_dir=tmp_path)) as restarted:
        assert (
            restarted.get("/invoices", headers={"Authorization": f"Bearer {token}"}).status_code
            == 401
        )


def test_me_does_not_extend_token_expiration(secure_app, monkeypatch):
    with TestClient(secure_app) as client:
        token = login(client)
        expiration = verify_session_token(token)["exp"]
        monkeypatch.setattr("api.auth.time.time", lambda: expiration - 30)
        refreshed = client.get("/auth/me").json()["session_id"]
        assert verify_session_token(refreshed)["exp"] == expiration
        monkeypatch.setattr("api.auth.time.time", lambda: expiration + 1)
        assert client.get("/auth/me").status_code == 401


def test_oauth_rejects_other_browsers_without_consuming_valid_state(secure_app, provider):
    with TestClient(secure_app) as owner, TestClient(secure_app) as other:
        login(owner)
        login(other)
        state, response = start_outlook(owner)
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie
        assert f"max-age={STATE_TTL_SECONDS}" in cookie
        assert "outlook_error=" in callback(other, state).headers["location"]
        assert not provider.called
        assert not other.get("/outlook/status").json()["connected"]
        assert "outlook=connected" in callback(owner, state).headers["location"]
        assert owner.cookies.get(OAUTH_BROWSER_COOKIE) is None
        assert owner.get("/outlook/status").json()["connected"]
        # Both logins belong to the same approved account, so its linked inbox persists.
        assert other.get("/outlook/status").json()["connected"]
        assert "outlook_error=" in callback(owner, state).headers["location"]
        assert provider.call_count == 1


def test_oauth_nonce_alone_cannot_switch_app_sessions(secure_app, provider):
    with TestClient(secure_app) as owner, TestClient(secure_app) as other:
        login(owner)
        login(other)
        state, _ = start_outlook(owner)
        other.cookies.set(OAUTH_BROWSER_COOKIE, owner.cookies.get(OAUTH_BROWSER_COOKIE))
        assert "outlook_error=" in callback(other, state).headers["location"]
        assert not provider.called
        assert "outlook=connected" in callback(owner, state).headers["location"]


@pytest.mark.parametrize("invalidate", ["logout", "missing_nonce", "expired", "legacy_state"])
def test_oauth_rejects_invalidated_flows(secure_app, provider, invalidate):
    with TestClient(secure_app) as client:
        login(client)
        state, _ = start_outlook(client)
        if invalidate == "logout":
            client.post("/auth/sign-out", headers=TRUSTED)
        elif invalidate == "missing_nonce":
            client.cookies.delete(OAUTH_BROWSER_COOKIE)
        else:
            with secure_app.state.outlook_store.connect() as db:
                if invalidate == "expired":
                    db.execute(
                        "UPDATE outlook_oauth_states SET created_at=? WHERE state=?",
                        (time.time() - STATE_TTL_SECONDS - 1, state),
                    )
                else:
                    db.execute(
                        "UPDATE outlook_oauth_states SET browser_nonce_hash=NULL WHERE state=?",
                        (state,),
                    )
        assert "outlook_error=" in callback(client, state).headers["location"]
        assert not provider.called


def test_oauth_cookie_is_secure_over_https(secure_app):
    with TestClient(secure_app, base_url="https://testserver") as client:
        login(client)
        _, response = start_outlook(client)
        cookie = response.headers["set-cookie"].lower()
        assert "secure" in cookie and "samesite=lax" in cookie and "httponly" in cookie
