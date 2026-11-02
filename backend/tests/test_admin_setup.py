"""Email-first setup does not reserve accounts and cannot race or bypass inbox proof."""

import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS

from api import security_mail
from api.app import create_app

pytestmark = pytest.mark.mfa
OWNER = "owner@example.com"


@pytest.fixture
def environment(monkeypatch):
    messages, clock = [], [int(time.time())]
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_isolated_fake_key_never_sent")
    for name in ("AUTH_USERNAME", "AUTH_PASSWORD", "AUTH_SETUP_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(
        security_mail, "send_code", lambda address, code, delivery: messages.append((address, code))
    )
    monkeypatch.setattr("api.admin_setup.now_seconds", lambda: clock[0])
    return messages, clock


@pytest.fixture
def client(environment, tmp_path):
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        yield client


def begin(client):
    response = client.post("/auth/setup/start", headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def prove(client, environment):
    challenge = begin(client)
    response = client.post(
        "/auth/setup/verify",
        headers=HEADERS,
        json={"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]},
    )
    assert response.status_code == 200, response.text
    return response.json()["setup_grant"]


def complete(client, grant, **values):
    return client.post(
        "/auth/setup/complete", headers=HEADERS, json={**ADMIN, "setup_grant": grant, **values}
    )


def clear_windows(client):
    with client.app.state.store.connect() as db:
        db.execute("DELETE FROM request_limits")


def test_setup_works_with_email_only_and_no_configured_password_or_setup_token(client, environment):
    status = client.get("/auth/setup-status").json()
    assert status["setup_required"] and status["setup_destination"] == "o***@example.com"
    grant = prove(client, environment)
    assert not client.app.state.accounts.has_accounts()
    assert client.get("/auth/me").status_code == 401
    response = complete(client, grant)
    assert response.status_code == 200, response.text
    assert client.get("/admin/accounts").status_code == 200
    assert client.get("/auth/mfa/status").json() == {"enabled": True, "email": OWNER}
    assert len(environment[0]) == 1
    assert client.get("/auth/setup-status").json()["setup_required"] is False


def test_forged_completion_is_rejected_before_password_hashing(client, monkeypatch):
    monkeypatch.setattr(
        "api.admin_setup.hash_password",
        lambda *_: pytest.fail("Unverified request reached password hashing"),
    )
    response = complete(client, "unverified-grant-longer-than-32-characters")
    assert response.status_code == 401
    assert not client.app.state.accounts.has_accounts()


def test_wrong_codes_never_reserve_the_first_admin_and_attempts_persist(client, environment):
    challenge = begin(client)
    for _ in range(5):
        response = client.post(
            "/auth/setup/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": "incorrect"},
        )
        assert response.status_code == 401
    valid_code = environment[0][-1][1]
    assert (
        client.post(
            "/auth/setup/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": valid_code},
        ).status_code
        == 401
    )
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT attempts FROM admin_setup_codes").fetchone()[0] == 5
    assert not client.app.state.accounts.has_accounts()
    clear_windows(client)
    grant = prove(client, environment)
    assert complete(client, grant).status_code == 200


def test_codes_and_verified_password_creation_grants_expire(client, environment):
    challenge = begin(client)
    environment[1][0] += 300
    assert (
        client.post(
            "/auth/setup/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]},
        ).status_code
        == 401
    )
    clear_windows(client)
    grant = prove(client, environment)
    environment[1][0] += 300
    assert complete(client, grant).status_code == 401
    assert not client.app.state.accounts.has_accounts()


def test_setup_proof_cannot_be_used_for_signin_or_for_a_different_email(
    client, environment, monkeypatch
):
    challenge = begin(client)
    code = environment[0][-1][1]
    assert (
        client.post(
            "/auth/mfa/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": code},
        ).status_code
        == 401
    )
    result = client.post(
        "/auth/setup/verify",
        headers=HEADERS,
        json={"challenge_id": challenge["challenge_id"], "code": code},
    )
    grant = result.json()["setup_grant"]
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", "new-owner@example.com")
    assert complete(client, grant).status_code == 401
    assert not client.app.state.accounts.has_accounts()


def test_code_verification_is_one_use_and_does_not_issue_a_login(client, environment):
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]}
    result = client.post("/auth/setup/verify", headers=HEADERS, json=payload)
    assert result.status_code == 200
    assert "session_id" not in result.json() and "ic_session" not in client.cookies
    assert client.post("/auth/setup/verify", headers=HEADERS, json=payload).status_code == 401
    assert not client.app.state.accounts.has_accounts()


def test_resending_cannot_redirect_mail_and_retires_the_old_challenge(client, environment):
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "email": "attacker@example.com"}
    assert client.post("/auth/setup/resend", headers=HEADERS, json=payload).status_code == 429
    clear_windows(client)
    response = client.post("/auth/setup/resend", headers=HEADERS, json=payload)
    assert response.status_code == 200
    assert all(address == OWNER for address, _ in environment[0])
    assert (
        client.post(
            "/auth/setup/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": environment[0][0][1]},
        ).status_code
        == 401
    )


def test_new_email_requests_cannot_invalidate_already_verified_password_creation(
    client, environment
):
    grant = prove(client, environment)
    clear_windows(client)
    begin(client)
    assert complete(client, grant).status_code == 200


def test_concurrent_verified_setups_can_create_only_one_administrator(client, environment):
    first = prove(client, environment)
    clear_windows(client)
    second = prove(client, environment)
    service = client.app.state.accounts.administrator_setup

    def attempt(item):
        try:
            return service.complete(item[0], item[1], "isolated-concurrent-password-2026")["id"]
        except HTTPException as exc:
            assert exc.status_code == 409
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(attempt, [(first, "first-admin"), (second, "second-admin")]))
    assert sum(value is not None for value in result) == 1
    assert len(client.app.state.accounts.list_users()) == 1
    assert client.post("/auth/setup/start", headers=HEADERS).status_code == 409
    assert complete(client, first).status_code == 409


def test_invalid_username_or_password_does_not_consume_verified_setup(client, environment):
    grant = prove(client, environment)
    assert complete(client, grant, username="bad username").status_code == 422
    assert complete(client, grant, password="short").status_code == 422
    assert not client.app.state.accounts.has_accounts()
    assert complete(client, grant).status_code == 200


def test_delivery_failure_does_not_create_an_account_or_leave_a_valid_code(client, monkeypatch):
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda *_: (_ for _ in ()).throw(HTTPException(503, "Delivery failed")),
    )
    assert client.post("/auth/setup/start", headers=HEADERS).status_code == 503
    assert not client.app.state.accounts.has_accounts()
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM admin_setup_codes").fetchone()[0] == 0


def test_all_setup_mutations_require_csrf_and_validation_does_not_echo_secrets(client):
    for path in ("start", "verify", "resend", "complete"):
        assert client.post("/auth/setup/" + path, json={}).status_code == 403
    result = complete(client, "sensitive-private-input" * 30)
    assert result.status_code == 422 and "sensitive-private-input" not in result.text
    assert not client.app.state.accounts.has_accounts()


def test_setup_code_and_grant_storage_is_private_and_portable(session_store, environment):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    challenge = accounts.administrator_setup.start()
    result = accounts.administrator_setup.verify(challenge["challenge_id"], environment[0][-1][1])
    with accounts.connect() as db:
        stored = dict(
            accounts.execute(db, f"SELECT * FROM {accounts.table('admin_setup_grants')}").fetchone()
        )
        assert stored["id"] != result["setup_grant"] and len(stored["id"]) == 64
    user = accounts.administrator_setup.complete(
        result["setup_grant"], "email-owner", "isolated-owner-password-2026"
    )
    sid, expiry = accounts.create_session(user, 3600, mfa_verified=True)
    assert (
        accounts.session_claims(sid, user["username"], expiry)["workspace_id"]
        == user["workspace_id"]
    )
