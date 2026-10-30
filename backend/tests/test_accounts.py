"""Approved-account access, private durable ownership, and credential invalidation."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import create_session_token, verify_session_token
from api.passwords import hash_password, verify_password
from api.stages import FixtureStages

DATA = Path(__file__).resolve().parents[2] / "data/dummy"
HEADERS = {"X-Requested-With": "InvoiceChecker", "Origin": "http://localhost:3000"}
ADMIN = {"username": "operator", "password": "operator-test-password-2026"}
MEMBER = {"username": "approved-member", "password": "member-test-password-2026"}


@pytest.fixture
def approved_app(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.delenv("DATABASE_URL", raising=False)
    return create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), start_worker=False)


def login(client, credentials=ADMIN):
    response = client.post("/auth/sign-in", json=credentials, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def add_member(client, credentials=MEMBER):
    response = client.post("/admin/accounts", headers=HEADERS, json=credentials)
    assert response.status_code == 201, response.text
    return response.json()


def test_only_approved_credentials_can_sign_in(approved_app):
    with TestClient(approved_app) as admin:
        for credentials in [
            {"username": "stranger", "password": "unapproved-password"},
            {"username": "demo-account", "password": "invoice-checker"},
        ]:
            assert admin.post("/auth/sign-in", json=credentials, headers=HEADERS).status_code == 401
        login(admin)
        account = add_member(admin)
        assert set(account) == {"id", "username", "role", "active", "created_at"}
        assert account["role"] == "member" and account["active"] is True
        admin.cookies.clear()
        assert login(admin, MEMBER)["user"]["role"] == "member"
        assert admin.post("/auth/register", json=MEMBER, headers=HEADERS).status_code == 404


def test_member_cannot_manage_accounts_or_access_another_workspace(approved_app):
    with TestClient(approved_app) as client:
        admin_login = login(client)
        member = add_member(client)
        admin_id = admin_login["user"]["id"]
        store = approved_app.state.store
        invoice_id = "11111111-1111-1111-1111-111111111111"
        store.insert(
            invoice_id, "private.pdf", "private-hash", "fixture", "v1", session_id=admin_id
        )
        store.update(invoice_id, "failed", error="reading: synthetic")
        client.cookies.clear()
        member_login = login(client, MEMBER)
        assert member_login["user"]["id"] != admin_id
        assert client.get("/invoices").json() == []
        assert client.get("/invoices/" + invoice_id).status_code == 404
        assert client.get("/admin/accounts").status_code == 403
        assert (
            client.post(
                "/admin/accounts", json={**MEMBER, "username": "unapproved"}, headers=HEADERS
            ).status_code
            == 403
        )
        assert (
            client.patch(
                "/admin/accounts/" + member["id"], json={"role": "admin"}, headers=HEADERS
            ).status_code
            == 403
        )
        assert client.get("/invoices", headers={"X-Invoice-Session": admin_id}).json() == []


def test_disable_and_reenable_never_reactivate_old_sessions(approved_app):
    with TestClient(approved_app) as client:
        admin = login(client)
        member = add_member(client)
        client.cookies.clear()
        token = login(client, MEMBER)["session_id"]
        client.cookies.clear()
        client.cookies.set("ic_session", admin["session_id"])
        assert (
            client.patch(
                "/admin/accounts/" + member["id"], json={"active": False}, headers=HEADERS
            ).status_code
            == 200
        )
        client.cookies.clear()
        assert (
            client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
        assert client.post("/auth/sign-in", json=MEMBER, headers=HEADERS).status_code == 401
        client.cookies.set("ic_session", admin["session_id"])
        assert (
            client.patch(
                "/admin/accounts/" + member["id"], json={"active": True}, headers=HEADERS
            ).status_code
            == 200
        )
        client.cookies.clear()
        assert (
            client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
        assert login(client, MEMBER)["user"]["id"] == member["id"]


def test_admin_reset_invalidates_credentials_and_all_existing_sessions(approved_app):
    with TestClient(approved_app) as client:
        admin = login(client)
        member = add_member(client)
        client.cookies.clear()
        old = login(client, MEMBER)["session_id"]
        client.cookies.clear()
        client.cookies.set("ic_session", admin["session_id"])
        new = "replacement-member-password-2026"
        assert (
            client.patch(
                "/admin/accounts/" + member["id"], headers=HEADERS, json={"password": new}
            ).status_code
            == 200
        )
        client.cookies.clear()
        assert (
            client.get("/invoices", headers={"Authorization": "Bearer " + old}).status_code == 401
        )
        assert client.post("/auth/sign-in", headers=HEADERS, json=MEMBER).status_code == 401
        assert login(client, {**MEMBER, "password": new})["user"]["id"] == member["id"]


def test_relogin_and_password_change_preserve_private_data(approved_app):
    with TestClient(approved_app) as client:
        first = login(client)
        owner = first["user"]["id"]
        approved_app.state.store.insert(
            "invoice-private", "sample.pdf", "hash", "fixture", "v1", session_id=owner
        )
        approved_app.state.store.update("invoice-private", "failed", error="reading: test")
        client.post("/auth/sign-out", headers=HEADERS)
        second = login(client)
        assert second["user"]["id"] == owner
        assert (
            verify_session_token(first["session_id"])["session_id"]
            != verify_session_token(second["session_id"])["session_id"]
        )
        assert len(client.get("/invoices").json()) == 1
        changed = "operator-new-password-2026"
        assert (
            client.put(
                "/auth/password",
                headers=HEADERS,
                json={"current_password": ADMIN["password"], "new_password": changed},
            ).status_code
            == 200
        )
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + second["session_id"]}
            ).status_code
            == 401
        )
        assert login(client, {**ADMIN, "password": changed})["user"]["id"] == owner
        assert len(client.get("/invoices").json()) == 1


def test_unregistered_signed_session_and_self_access_changes_are_denied(approved_app):
    with TestClient(approved_app) as client:
        admin = login(client)
        token = create_session_token(ADMIN["username"], "unregistered-random-session")
        client.cookies.clear()
        assert (
            client.get("/invoices", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
        client.cookies.set("ic_session", admin["session_id"])
        assert (
            client.patch(
                "/admin/accounts/" + admin["user"]["id"], json={"active": False}, headers=HEADERS
            ).status_code
            == 409
        )
        assert client.get("/auth/me").status_code == 200


def test_one_time_setup_requires_token_and_cannot_be_replayed(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    token = "isolated-one-time-setup-token-2026-for-tests"
    monkeypatch.setenv("AUTH_SETUP_TOKEN", token)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        assert client.get("/auth/setup-status").json()["setup_required"]
        assert (
            client.post(
                "/auth/setup",
                headers=HEADERS,
                json={**ADMIN, "token": "incorrect-setup-token-with-32-characters"},
            ).status_code
            == 403
        )
        assert client.post("/auth/setup", json={**ADMIN, "token": token}).status_code == 403
        response = client.post("/auth/setup", headers=HEADERS, json={**ADMIN, "token": token})
        assert response.status_code == 200 and response.json()["user"]["role"] == "admin"
        assert not client.get("/auth/setup-status").json()["setup_required"]
        assert (
            client.post("/auth/setup", headers=HEADERS, json={**MEMBER, "token": token}).status_code
            == 409
        )


@pytest.mark.parametrize("problem", ["missing_secret", "short_secret", "default_credentials"])
def test_production_authentication_rejects_insecure_configuration(tmp_path, monkeypatch, problem):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    if problem == "missing_secret":
        monkeypatch.delenv("AUTH_SECRET", raising=False)
    if problem == "short_secret":
        monkeypatch.setenv("AUTH_SECRET", "too-short")
    if problem == "default_credentials":
        monkeypatch.setenv("AUTH_USERNAME", "demo-account")
        monkeypatch.setenv("AUTH_PASSWORD", "invoice-checker")
    with pytest.raises(ValueError, match="AUTH_SECRET|Default demo"):
        with TestClient(create_app(storage_dir=tmp_path, start_worker=False)):
            pass


def test_password_hashes_are_salted_bounded_and_never_plaintext():
    password = "unicode-password-密码-2026"
    first, second = hash_password(password), hash_password(password)
    assert first != second and password not in first
    assert verify_password(password, first)
    assert not verify_password("incorrect-password", first)
    assert not verify_password(password, first.replace("m=19456", "m=999999999"))
    assert not verify_password("x" * 129, first)


def test_login_attempts_are_limited_and_persist_across_restart(approved_app, tmp_path):
    with TestClient(approved_app) as client:
        for _ in range(8):
            assert (
                client.post(
                    "/auth/sign-in", headers=HEADERS, json={**ADMIN, "password": "wrong"}
                ).status_code
                == 401
            )
        limited = client.post("/auth/sign-in", headers=HEADERS, json=ADMIN)
        assert limited.status_code == 429 and int(limited.headers["Retry-After"]) > 0
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        assert client.post("/auth/sign-in", headers=HEADERS, json=ADMIN).status_code == 429


def test_validation_never_echoes_passwords_or_setup_codes(approved_app):
    with TestClient(approved_app) as client:
        login(client)
        secret = "bad-secret"
        response = client.post(
            "/admin/accounts", headers=HEADERS, json={"username": "x", "password": secret}
        )
        assert response.status_code == 422
        assert secret not in response.text
        assert all("input" not in error for error in response.json()["detail"])


def test_setup_tool_keeps_the_one_time_code_in_local_files(tmp_path, monkeypatch, capsys):
    from urllib.parse import parse_qs, urlparse

    from api.accounts import Accounts
    from api.manage_accounts import prepare_setup
    from api.storage import Store

    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    store = Store(tmp_path)
    accounts = Accounts(store)
    env_file = tmp_path / ".env"
    prepare_setup(env_file, store, accounts)
    link = (tmp_path / "admin-setup.url").read_text().split("URL=", 1)[1].strip()
    code = parse_qs(urlparse(link).fragment)["token"][0]
    assert len(code) >= 32
    assert code not in capsys.readouterr().out
    assert not accounts.has_accounts()
    monkeypatch.setenv("AUTH_SETUP_TOKEN", code)
    assert accounts.setup(code, "chosen-admin", "chosen-admin-password-2026")["role"] == "admin"


def test_legacy_recovery_is_explicit_private_and_refuses_an_approved_owner(
    approved_app, tmp_path, monkeypatch
):
    from api import manage_accounts

    with TestClient(approved_app) as client:
        admin = login(client)
        member = add_member(client)
        store = approved_app.state.store
        store.insert(
            "legacy-invoice",
            "original.pdf",
            "legacy-hash",
            "fixture",
            "v1",
            session_id="exact-legacy-session",
        )
        store.update("legacy-invoice", "failed", error="reading: synthetic")
        monkeypatch.setenv("INVOICE_DATA_DIR", str(tmp_path))
        monkeypatch.setattr(manage_accounts, "load_settings", lambda: tmp_path / ".env")
        monkeypatch.setattr(
            "sys.argv",
            [
                "manage_accounts",
                "recover-workspace",
                "--source",
                "exact-legacy-session",
                "--username",
                MEMBER["username"],
            ],
        )
        manage_accounts.main()
        assert store.get("legacy-invoice", session_id=member["id"]) is not None
        assert store.get("legacy-invoice", session_id=admin["user"]["id"]) is None
        assert store.get("legacy-invoice", session_id="exact-legacy-session") is None
        monkeypatch.setattr(
            "sys.argv",
            [
                "manage_accounts",
                "recover-workspace",
                "--source",
                admin["user"]["id"],
                "--username",
                MEMBER["username"],
            ],
        )
        with pytest.raises(ValueError, match="approved account"):
            manage_accounts.main()


def test_invalid_json_login_attempts_are_limited_before_validation(approved_app):
    with TestClient(approved_app) as client:
        for _ in range(20):
            response = client.post(
                "/auth/sign-in",
                headers={**HEADERS, "Content-Type": "application/json"},
                content="invalid-json",
            )
            assert response.status_code == 422
        response = client.post("/auth/sign-in", headers=HEADERS, json=ADMIN)
        assert response.status_code == 429 and "Retry-After" in response.headers


def test_admin_mutations_recheck_access_inside_the_write_transaction(approved_app):
    from fastapi import HTTPException

    with TestClient(approved_app) as client:
        admin = login(client)
        accounts = approved_app.state.accounts
        session_id = verify_session_token(admin["session_id"])["session_id"]
        second = accounts.create_user("another-admin", "another-admin-password-2026", "admin")
        accounts.update_user(admin["user"]["id"], actor=second["id"], role="member")
        with pytest.raises(HTTPException) as denied:
            accounts.create_user(
                "should-not-exist",
                "a-private-password-2026",
                "admin",
                actor=admin["user"]["id"],
                actor_session=session_id,
            )
        assert denied.value.status_code == 403
        accounts.update_user(admin["user"]["id"], actor=second["id"], role="admin")
        with pytest.raises(HTTPException):
            accounts.create_user(
                "still-not-approved",
                "a-private-password-2026",
                "admin",
                actor=admin["user"]["id"],
                actor_session=session_id,
            )
