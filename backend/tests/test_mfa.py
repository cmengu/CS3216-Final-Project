"""Mandatory email verification; all delivery is captured or mocked, never sent."""

import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, DATA, HEADERS, MEMBER, add_member

from api import security_mail
from api.app import create_app
from api.auth import create_session_token
from api.mfa import CHALLENGE_SECONDS
from api.stages import FixtureStages

pytestmark = pytest.mark.mfa
_REAL_SEND_CODE = security_mail.send_code
OWNER = "owner@example.com"
MEMBER_EMAIL = "member@example.com"


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    sent = []
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_isolated_fake_api_key_never_sent")
    monkeypatch.delenv("AUTH_EMAIL_TEST_RECIPIENT", raising=False)
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda recipient, code, delivery_id: sent.append((recipient, code, delivery_id)),
    )
    return sent


@pytest.fixture
def clock(monkeypatch):
    value = [int(time.time())]
    monkeypatch.setattr("api.mfa.now_seconds", lambda: value[0])
    return value


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.delenv("DATABASE_URL", raising=False)
    return create_app(storage_dir=tmp_path, stages=FixtureStages(DATA), start_worker=False)


def start(client, credentials=ADMIN):
    response = client.post("/auth/sign-in", headers=HEADERS, json=credentials)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mfa_required"] is True and "session_id" not in body and "user" not in body
    assert "ic_session" not in client.cookies
    return body


def verify(client, challenge, code):
    return client.post(
        "/auth/mfa/verify",
        headers=HEADERS,
        json={"challenge_id": challenge["challenge_id"], "code": code},
    )


def login(client, mail, credentials=ADMIN):
    challenge = start(client, credentials)
    response = verify(client, challenge, mail[-1][1])
    assert response.status_code == 200, response.text
    return response.json()


def cooldown(app, user_id=None):
    # Production rate limits remain real; simulate time passing in persisted windows.
    with app.state.store.connect() as db:
        db.execute("DELETE FROM request_limits")


def test_first_admin_verifies_the_owner_email_before_choosing_credentials(
    tmp_path, monkeypatch, mail
):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_SETUP_TOKEN", raising=False)
    app = create_app(storage_dir=tmp_path, start_worker=False)
    with TestClient(app) as client:
        response = client.post(
            "/auth/setup/start", headers=HEADERS, json={"email": "attacker@example.com"}
        )
        assert response.status_code == 200, response.text
        challenge = response.json()
        assert mail[-1][0] == OWNER
        assert challenge["destination"] == "o***@example.com"
        assert not app.state.accounts.has_accounts()
        assert client.get("/admin/accounts").status_code == 401
        verified = client.post(
            "/auth/setup/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": mail[-1][1]},
        )
        assert verified.status_code == 200
        assert not app.state.accounts.has_accounts()
        completed = client.post(
            "/auth/setup/complete",
            headers=HEADERS,
            json={**ADMIN, **verified.json(), "email": "attacker@example.com"},
        )
        assert completed.status_code == 200
        assert client.get("/admin/accounts").status_code == 200
        assert client.get("/auth/mfa/status").json()["email"] == OWNER
        cooldown(app)
        pending = start(client)
        with app.state.store.connect() as db:
            stored = dict(db.execute("SELECT * FROM email_challenges").fetchone())
            assert stored["id"] != pending["challenge_id"]
            assert stored["code_hash"] != mail[-1][1]
            assert len(stored["code_hash"]) == 64


def test_every_member_needs_a_registered_email_and_verifies_it(app, mail):
    with TestClient(app) as client:
        admin = login(client, mail)
        assert client.post("/admin/accounts", headers=HEADERS, json=MEMBER).status_code == 422
        member = add_member(client, {**MEMBER, "email": MEMBER_EMAIL})
        assert member["email"] == MEMBER_EMAIL
        challenge = start(client, {**MEMBER, "email": "attacker@example.com"})
        assert mail[-1][0] == MEMBER_EMAIL
        assert client.get("/projects").status_code == 401
        assert verify(client, challenge, mail[-1][1]).status_code == 200
        assert client.get("/admin/accounts").status_code == 403
        assert client.get("/projects").json() == []
        assert client.get("/auth/mfa/status").json() == {"enabled": True, "email": MEMBER_EMAIL}
        assert client.get("/auth/me").json()["user"]["id"] != admin["user"]["id"]


def test_invalid_codes_attempts_are_persisted_and_challenges_expire(app, clock, mail):
    with TestClient(app) as client:
        challenge = start(client)
        for _ in range(5):
            assert verify(client, challenge, "invalid").status_code == 401
        assert verify(client, challenge, mail[-1][1]).status_code == 401
        with app.state.store.connect() as db:
            assert db.execute("SELECT attempts FROM email_challenges").fetchone()["attempts"] == 5
        cooldown(app)
        fresh = start(client)
        clock[0] += CHALLENGE_SECONDS
        assert verify(client, fresh, mail[-1][1]).status_code == 401


def test_code_and_challenge_are_single_use_under_concurrent_verification(app, mail):
    with TestClient(app) as client:
        challenge = start(client)
        code = mail[-1][1]

        def attempt(_):
            try:
                app.state.accounts.mfa.verify(challenge["challenge_id"], code)
                return True
            except HTTPException:
                return False

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(attempt, range(2))).count(True) == 1
        assert verify(client, challenge, code).status_code == 401


def test_resend_is_throttled_and_replaces_the_old_code(app, mail):
    with TestClient(app) as client:
        challenge = start(client)
        original_code = mail[-1][1]
        assert (
            client.post(
                "/auth/mfa/resend",
                headers=HEADERS,
                json={"challenge_id": challenge["challenge_id"]},
            ).status_code
            == 429
        )
        cooldown(app)
        response = client.post(
            "/auth/mfa/resend", headers=HEADERS, json={"challenge_id": challenge["challenge_id"]}
        )
        assert response.status_code == 200
        fresh = response.json()
        assert fresh["challenge_id"] != challenge["challenge_id"]
        assert verify(client, challenge, original_code).status_code == 401
        assert verify(client, fresh, mail[-1][1]).status_code == 200


def test_email_change_is_operator_only_and_revokes_sessions_and_pending_codes(app, mail):
    with TestClient(app) as client:
        original = login(client, mail)
        user_id = original["user"]["id"]
        cooldown(app)
        pending = start(client)
        old_code = mail[-1][1]
        app.state.accounts.mfa.set_by_operator(user_id, "replacement@example.com")
        assert verify(client, pending, old_code).status_code == 401
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + original["session_id"]}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/auth/mfa/replace", headers=HEADERS, json={"email": "attacker@example.com"}
            ).status_code
            == 404
        )
        cooldown(app)
        fresh = start(client)
        assert mail[-1][0] == "replacement@example.com"
        assert verify(client, fresh, mail[-1][1]).status_code == 200


def test_password_reset_preserves_email_and_invalidates_pending_codes(app, mail):
    with TestClient(app) as client:
        original = login(client, mail)
        cooldown(app)
        pending = start(client)
        pending_code = mail[-1][1]
        other = app.state.accounts.create_user(
            "other-admin", "another-private-admin-password", "admin", email="other@example.com"
        )
        app.state.accounts.update_user(
            original["user"]["id"], actor=other["id"], password="new-private-password-2026"
        )
        assert verify(client, pending, pending_code).status_code == 401
        cooldown(app)
        fresh = start(client, {**ADMIN, "password": "new-private-password-2026"})
        assert mail[-1][0] == OWNER
        assert verify(client, fresh, mail[-1][1]).status_code == 200


def test_existing_account_without_registered_email_cannot_self_claim_one(app):
    with TestClient(app) as client:
        app.state.accounts.create_user(MEMBER["username"], MEMBER["password"], "member")
        response = client.post(
            "/auth/sign-in", headers=HEADERS, json={**MEMBER, "email": "attacker@example.com"}
        )
        assert response.status_code == 409
        assert "ic_session" not in client.cookies


def test_password_only_or_legacy_authenticator_sessions_cannot_bypass_email_verification(app):
    with TestClient(app) as client:
        user = app.state.accounts.authenticate(ADMIN["username"], ADMIN["password"])
        with pytest.raises(HTTPException):
            app.state.accounts.create_session(user, 3600)
        with app.state.accounts.connect() as db:
            db.execute(
                "INSERT INTO account_sessions (id,user_id,version,expires_at) VALUES (?,?,?,?)",
                ("old-password-session", user["id"], user["version"], int(time.time()) + 3600),
            )
            db.execute("CREATE TABLE mfa_verified_sessions (id TEXT PRIMARY KEY)")
            db.execute("INSERT INTO mfa_verified_sessions VALUES ('old-password-session')")
        token = create_session_token(ADMIN["username"], "old-password-session")
        assert (
            client.get("/invoices", headers={"Authorization": "Bearer " + token}).status_code == 401
        )


def test_email_verification_requires_csrf_and_validation_does_not_echo_codes(app, mail):
    with TestClient(app) as client:
        challenge = start(client)
        assert (
            client.post(
                "/auth/mfa/verify",
                json={"challenge_id": challenge["challenge_id"], "code": mail[-1][1]},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/auth/mfa/resend", json={"challenge_id": challenge["challenge_id"]}
            ).status_code
            == 403
        )
        result = client.post(
            "/auth/mfa/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": "secret-input" * 30},
        )
        assert result.status_code == 422 and "secret-input" not in result.text


def test_missing_sender_configuration_does_not_consume_first_admin_setup(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.setenv("AUTH_SETUP_TOKEN", "isolated-admin-setup-token-with-32-characters")
    monkeypatch.delenv("RESEND_API_KEY")
    app = create_app(storage_dir=tmp_path, start_worker=False)
    with TestClient(app) as client:
        response = client.post(
            "/auth/setup/start",
            headers=HEADERS,
        )
        assert response.status_code == 503
        assert not app.state.accounts.has_accounts()


def test_delivery_failure_invalidates_pending_code_and_never_grants_access(app, monkeypatch):
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda *_: (_ for _ in ()).throw(HTTPException(503, "Email delivery unavailable")),
    )
    with TestClient(app) as client:
        assert client.post("/auth/sign-in", headers=HEADERS, json=ADMIN).status_code == 503
        assert client.get("/auth/me").status_code == 401
        with app.state.store.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM email_challenges").fetchone()[0] == 0


def test_unverified_resend_sender_is_restricted_to_owner_without_recipient_rewrite(
    app, monkeypatch, mail
):
    with TestClient(app) as client:
        login(client, mail)
        add_member(client, {**MEMBER, "email": MEMBER_EMAIL})
        monkeypatch.setenv("AUTH_EMAIL_FROM", "onboarding@resend.dev")
        monkeypatch.setenv("AUTH_EMAIL_TEST_RECIPIENT", OWNER)
        previous = len(mail)
        assert client.post("/auth/sign-in", headers=HEADERS, json=MEMBER).status_code == 503
        assert len(mail) == previous


def test_registered_email_ownership_and_proof_are_portable(session_store, mail):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    user = accounts.create_user(
        "email-member", "isolated-email-member-password", "member", email=MEMBER_EMAIL
    )
    challenge = accounts.mfa.begin(user)
    verified, _ = accounts.mfa.verify(challenge["challenge_id"], mail[-1][1])
    sid, expires = accounts.create_session(verified, 3600, mfa_verified=True)
    assert (
        accounts.session_claims(sid, user["username"], expires)["workspace_id"]
        == user["workspace_id"]
    )
    accounts.mfa.set_by_operator(user["id"], "replacement@example.com")
    assert accounts.session_claims(sid, user["username"], expires) is None


def test_pending_email_challenge_survives_restart(tmp_path, monkeypatch, mail):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        challenge = start(client)
        code = mail[-1][1]
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        assert verify(client, challenge, code).status_code == 200


def test_resend_request_uses_fixed_https_destination_and_no_redirects(monkeypatch):
    real_send = _REAL_SEND_CODE
    captured = []

    def post(url, **kwargs):
        captured.append((url, kwargs))
        return httpx.Response(200, json={"id": "email-test-id"})

    monkeypatch.setattr(httpx, "post", post)
    real_send(OWNER, "123456", "opaque-delivery-id")
    url, values = captured[0]
    assert url == "https://api.resend.com/emails"
    assert values["follow_redirects"] is False and values["timeout"] == 10
    assert values["json"]["to"] == [OWNER]
    assert "123456" in values["json"]["text"]


def test_sender_failures_do_not_expose_api_keys_codes_or_provider_bodies(monkeypatch):
    real_send = _REAL_SEND_CODE
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: httpx.Response(403, json={"secret": "private-provider-response-123456"}),
    )
    with pytest.raises(HTTPException) as failure:
        real_send(OWNER, "123456", "opaque-id")
    assert failure.value.status_code == 503
    assert "123456" not in failure.value.detail and "private-provider" not in failure.value.detail


def test_duplicate_or_invalid_email_is_rejected_atomically(app, mail):
    with TestClient(app) as client:
        login(client, mail)
        for email in (OWNER, "bad\r\nBcc: attacker@example.com", "not-an-email"):
            response = client.post("/admin/accounts", headers=HEADERS, json={"email": email})
            assert response.status_code in {409, 422}
        assert len(client.get("/admin/accounts").json()) == 1
