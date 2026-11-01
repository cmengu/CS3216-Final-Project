"""Unique invitations prove their approved inbox and never create an account on a GET."""

from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, MEMBER
from test_mfa import login

from api import security_mail
from api.app import create_app

pytestmark = pytest.mark.mfa
OWNER = "owner@example.com"
EMAIL = "member@example.com"


@pytest.fixture
def environment(monkeypatch):
    sent, clock = [], [100000]
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_fake_invitation_key_never_sent")
    monkeypatch.setenv("FRONTEND_URL", "https://invoices.example.com")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        security_mail, "send_code", lambda address, code, delivery: sent.append((address, code))
    )
    monkeypatch.setattr(
        security_mail, "send_invitation", lambda address, url, delivery: sent.append((address, url))
    )
    monkeypatch.setattr("api.invitations.now_seconds", lambda: clock[0])
    monkeypatch.setattr("api.enrollment.now_seconds", lambda: clock[0])
    return sent, clock


@pytest.fixture
def client(environment, tmp_path):
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        yield client


def approve(client, environment, email=EMAIL):
    admin = login(client, environment[0])
    response = client.post("/admin/accounts", headers=HEADERS, json={"email": email})
    assert response.status_code == 201, response.text
    return response.json(), admin


def token(environment):
    return parse_qs(urlsplit(environment[0][-1][1]).fragment)["invite"][0]


def claim(client, value, **fields):
    return client.post("/auth/enroll/invitation", headers=HEADERS, json={"token": value, **fields})


def clear_windows(client):
    with client.app.state.store.connect() as db:
        db.execute("DELETE FROM request_limits")


def test_approval_emails_personal_link_and_link_creates_only_that_email(client, environment):
    approval, admin = approve(client, environment)
    assert approval["invitation_status"] == "sent" and approval["invitation_error"] is None
    assert environment[0][-1][0] == EMAIL
    url = environment[0][-1][1]
    assert url.startswith("https://invoices.example.com/join#invite=")
    assert "token" not in approval and token(environment) not in str(approval)
    assert len(client.app.state.accounts.list_users()) == 1
    client.cookies.clear()
    assert client.get("/auth/enroll/invitation").status_code == 405
    proof = claim(client, token(environment))
    assert proof.status_code == 200 and proof.json()["email"] == EMAIL
    assert "ic_session" not in client.cookies and len(client.app.state.accounts.list_users()) == 1
    result = client.post(
        "/auth/enroll/complete",
        headers=HEADERS,
        json={**MEMBER, "setup_grant": proof.json()["setup_grant"]},
    )
    assert result.status_code == 200 and result.json()["user"]["role"] == "member"
    row = client.app.state.accounts.get_user(result.json()["user"]["id"])
    assert row["email"] == EMAIL and row["workspace_id"] != admin["user"]["id"]
    assert client.get("/admin/accounts").status_code == 403


def test_invitation_is_single_use_and_revoke_invalidates_claimed_grant(client, environment):
    approval, admin = approve(client, environment)
    value = token(environment)
    proof = claim(client, value)
    assert proof.status_code == 200 and claim(client, value).status_code == 401
    assert (
        client.delete("/admin/account-approvals/" + approval["id"], headers=HEADERS).status_code
        == 200
    )
    assert (
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": proof.json()["setup_grant"]},
        ).status_code
        == 401
    )


def test_resend_retires_old_link_but_not_already_verified_grant(client, environment):
    approval, _ = approve(client, environment)
    old = token(environment)
    proof = claim(client, old).json()
    clear_windows(client)
    path = "/admin/account-approvals/" + approval["id"] + "/send"
    assert client.post(path, headers=HEADERS).json()["invitation_status"] == "sent"
    second = token(environment)
    assert claim(client, old).status_code == 401
    assert client.post(path, headers=HEADERS).status_code == 429
    clear_windows(client)
    assert client.post(path, headers=HEADERS).status_code == 200
    assert claim(client, second).status_code == 401
    assert (
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": proof["setup_grant"]},
        ).status_code
        == 200
    )
    assert claim(client, token(environment)).status_code == 401


def test_expiry_and_approval_identity_stop_reuse(client, environment):
    approval, _ = approve(client, environment)
    old = token(environment)
    environment[1][0] += 86400
    assert claim(client, old).status_code == 401
    client.delete("/admin/account-approvals/" + approval["id"], headers=HEADERS)
    response = client.post("/admin/accounts", headers=HEADERS, json={"email": EMAIL})
    assert response.status_code == 201 and response.json()["id"] != approval["id"]
    assert claim(client, old).status_code == 401


def test_delivery_failure_keeps_approval_and_shows_error_without_live_link(
    client, environment, monkeypatch
):
    monkeypatch.setattr(
        security_mail,
        "send_invitation",
        lambda *_: (_ for _ in ()).throw(HTTPException(503, "Sender connection unavailable")),
    )
    approval, _ = approve(client, environment)
    assert (
        approval["invitation_status"] == "failed"
        and approval["invitation_error"] == "Sender connection unavailable"
    )
    assert client.get("/admin/account-approvals").json() == [approval]
    with client.app.state.accounts.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM enrollment_invitations").fetchone()[0] == 0


def test_restricted_resend_sender_failure_is_visible_and_does_not_mint_link(
    client, environment, monkeypatch
):
    monkeypatch.setenv("AUTH_EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("AUTH_EMAIL_TEST_RECIPIENT", OWNER)
    approval, _ = approve(client, environment)
    assert (
        approval["invitation_status"] == "failed"
        and "test email sender" in approval["invitation_error"]
    )
    assert len(environment[0]) == 1  # only the administrator's sign-in code


def test_links_are_bound_to_email_and_password_form_cannot_choose_role_or_recipient(
    client, environment
):
    approval, _ = approve(client, environment)
    value = token(environment)
    assert claim(client, value, email=OWNER).status_code == 422
    proof = claim(client, value).json()
    assert (
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": proof["setup_grant"], "email": OWNER},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": proof["setup_grant"], "role": "admin"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": proof["setup_grant"]},
        ).status_code
        == 200
    )


def test_sending_rechecks_admin_session_and_claim_requires_csrf(client, environment):
    from api.auth import verify_session_token

    approval, admin = approve(client, environment)
    assert (
        client.post("/auth/enroll/invitation", json={"token": token(environment)}).status_code
        == 403
    )
    accounts = client.app.state.accounts
    sid = verify_session_token(admin["session_id"])["session_id"]
    accounts.end_session(sid)
    with pytest.raises(HTTPException) as result:
        accounts.enrollment.invitations.send(
            approval["id"], actor=admin["user"]["id"], actor_session=sid
        )
    assert result.value.status_code == 403


def test_concurrent_claims_succeed_only_once(client, environment):
    approve(client, environment)
    value = token(environment)

    def attempt(_):
        try:
            return bool(
                client.app.state.accounts.enrollment.invitations.claim(value)["setup_grant"]
            )
        except HTTPException as exc:
            assert exc.status_code == 401
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(attempt, range(2))) == 1


def test_invitation_storage_is_hashed_and_portable(session_store, environment):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    owner = accounts.create_user(ADMIN["username"], ADMIN["password"], "admin", email=OWNER)
    challenge = accounts.mfa.begin(owner)
    user, _ = accounts.mfa.verify(challenge["challenge_id"], environment[0][-1][1])
    sid, _ = accounts.create_session(user, 3600, mfa_verified=True)
    approval = accounts.enrollment.approve(EMAIL, actor=user["id"], actor_session=sid)
    accounts.enrollment.invitations.send(approval["id"], actor=user["id"], actor_session=sid)
    with accounts.connect() as db:
        stored = accounts.execute(
            db, f"SELECT id FROM {accounts.table('enrollment_invitations')}"
        ).fetchone()["id"]
        assert len(stored) == 64 and stored != token(environment)
    assert (
        Accounts(session_store).enrollment.invitations.claim(token(environment))["email"] == EMAIL
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://public.example.com",
        "https://attacker.example/path",
        "https://user:secret@example.com",
        "https://example.com/#private",
    ],
)
def test_unsafe_frontend_url_is_rejected(client, environment, monkeypatch, url):
    monkeypatch.setenv("FRONTEND_URL", url)
    approval, _ = approve(client, environment)
    assert approval["invitation_status"] == "failed"
    assert len(environment[0]) == 1
