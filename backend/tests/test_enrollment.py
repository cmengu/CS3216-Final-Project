"""Approval, email proof, revocation and atomic private-account enrollment."""

import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, MEMBER
from test_mfa import finish_setup, login, verify_login

from api import security_mail
from api.app import create_app

pytestmark = pytest.mark.mfa
EMAIL = "approved@example.com"


@pytest.fixture
def environment(monkeypatch):
    messages, clock = [], [int(time.time())]
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_fake_enrollment_test_key_never_sent")
    monkeypatch.delenv("AUTH_EMAIL_TEST_RECIPIENT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda address, code, delivery: messages.append((address, code, delivery)),
    )
    monkeypatch.setattr("api.enrollment.now_seconds", lambda: clock[0])
    return messages, clock


@pytest.fixture
def client(environment, tmp_path):
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        yield client


def approve(client, environment, email=EMAIL):
    login(client, environment[0])
    response = client.post("/admin/accounts", headers=HEADERS, json={"email": email})
    assert response.status_code == 201, response.text
    cookie = client.cookies.get("ic_session")
    client.cookies.clear()
    return response.json(), cookie


def begin(client, email=EMAIL):
    response = client.post("/auth/enroll/start", headers=HEADERS, json={"email": email})
    assert response.status_code == 200, response.text
    return response.json()


def prove(client, environment, email=EMAIL):
    challenge = begin(client, email)
    payload = {"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]}
    response = client.post("/auth/enroll/verify", headers=HEADERS, json=payload)
    assert response.status_code == 200, response.text
    return response.json()["setup_grant"]


def complete(client, grant, **values):
    return finish_setup(
        client,
        client.post(
            "/auth/enroll/complete",
            headers=HEADERS,
            json={**MEMBER, "setup_grant": grant, **values},
        ),
    )


def clear_windows(client):
    with client.app.state.store.connect() as db:
        db.execute("DELETE FROM request_limits")


def test_email_only_approval_then_private_member_chooses_credentials(client, environment):
    approval, _ = approve(client, environment, " Approved@EXAMPLE.com ")
    assert (
        set(approval) == {"id", "email", "created_at", "invitation_status", "invitation_error"}
        and approval["email"] == EMAIL
    )
    assert len(client.app.state.accounts.list_users()) == 1
    grant = prove(client, environment)
    assert environment[0][-1][0] == EMAIL
    assert len(client.app.state.accounts.list_users()) == 1
    assert client.get("/auth/me").status_code == 401
    response = complete(client, grant)
    assert response.status_code == 200, response.text
    user = response.json()["user"]
    assert user["role"] == "member"
    account = client.app.state.accounts.get_user(user["id"])
    assert account["workspace_id"] == user["id"] and account["email"] == EMAIL
    assert MEMBER["password"] not in account["password_hash"]
    assert client.get("/projects").json() == []
    assert client.get("/admin/accounts").status_code == 403
    assert client.app.state.accounts.enrollment.list_approvals() == []
    assert complete(client, grant).status_code == 401
    client.cookies.clear()
    clear_windows(client)
    pending = client.post("/auth/sign-in", headers=HEADERS, json=MEMBER).json()
    assert pending["mfa_required"] and client.get("/auth/me").status_code == 401
    assert environment[0][-1][0] == EMAIL
    assert pending["method"] == "totp"
    assert verify_login(client, pending).status_code == 200


def test_unknown_or_existing_email_cannot_register_or_reveal_approval(client, environment):
    approve(client, environment)
    previous = len(environment[0])
    for email in ("stranger@example.com", "owner@example.com"):
        challenge = begin(client, email)
        assert set(challenge) == {
            "mfa_required",
            "challenge_id",
            "destination",
            "expires_in",
            "resend_after",
        }
        assert len(environment[0]) == previous
        assert (
            client.post(
                "/auth/enroll/verify",
                headers=HEADERS,
                json={"challenge_id": challenge["challenge_id"], "code": "000000"},
            ).status_code
            == 401
        )
    assert len(client.app.state.accounts.list_users()) == 1


def test_approval_management_requires_live_admin_and_rejects_duplicates(client, environment):
    assert client.post("/admin/accounts", headers=HEADERS, json={"email": EMAIL}).status_code == 401
    approval, cookie = approve(client, environment)
    client.cookies.set("ic_session", cookie)
    assert client.get("/admin/account-approvals").json() == [approval]
    for email in (EMAIL, "owner@example.com"):
        assert (
            client.post("/admin/accounts", headers=HEADERS, json={"email": email}).status_code
            == 409
        )
    assert (
        client.post("/admin/accounts", headers=HEADERS, json={"email": EMAIL, **MEMBER}).status_code
        == 422
    )
    client.cookies.clear()
    assert client.get("/admin/account-approvals").status_code == 401
    grant = prove(client, environment)
    assert complete(client, grant).status_code == 200
    assert (
        client.post(
            "/admin/accounts", headers=HEADERS, json={"email": "other@example.com"}
        ).status_code
        == 403
    )
    assert (
        client.delete("/admin/account-approvals/" + approval["id"], headers=HEADERS).status_code
        == 403
    )


@pytest.mark.parametrize("verified", [False, True])
def test_revocation_invalidates_code_and_grant_even_after_reapproval(client, environment, verified):
    approval, cookie = approve(client, environment)
    challenge = begin(client)
    code = environment[0][-1][1]
    payload = {"challenge_id": challenge["challenge_id"], "code": code}
    grant = None
    if verified:
        grant = client.post("/auth/enroll/verify", headers=HEADERS, json=payload).json()[
            "setup_grant"
        ]
    client.cookies.set("ic_session", cookie)
    assert (
        client.delete("/admin/account-approvals/" + approval["id"], headers=HEADERS).status_code
        == 200
    )
    response = client.post("/admin/accounts", headers=HEADERS, json={"email": EMAIL})
    assert response.status_code == 201 and response.json()["id"] != approval["id"]
    client.cookies.clear()
    assert client.post("/auth/enroll/verify", headers=HEADERS, json=payload).status_code == 401
    if grant:
        assert complete(client, grant).status_code == 401
    assert len(client.app.state.accounts.list_users()) == 1


def test_unverified_or_role_escalating_completion_is_rejected(client, environment, monkeypatch):
    approve(client, environment)
    with monkeypatch.context() as scoped:
        scoped.setattr(
            "api.enrollment.hash_password", lambda *_: pytest.fail("Unverified password hashing")
        )
        assert complete(client, "forged-grant-longer-than-thirty-two-characters").status_code == 401
    grant = prove(client, environment)
    for values in (
        {"role": "admin"},
        {"email": "attacker@example.com"},
        {"workspace_id": "another-owner"},
    ):
        assert complete(client, grant, **values).status_code == 422
    assert complete(client, grant).json()["user"]["role"] == "member"


def test_bad_code_attempts_and_expiration_persist(client, environment):
    approve(client, environment)
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": "invalid"}
    for _ in range(5):
        assert client.post("/auth/enroll/verify", headers=HEADERS, json=payload).status_code == 401
    payload["code"] = environment[0][-1][1]
    assert client.post("/auth/enroll/verify", headers=HEADERS, json=payload).status_code == 401
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT attempts FROM enrollment_codes").fetchone()[0] == 5
    clear_windows(client)
    challenge = begin(client)
    environment[1][0] += 300
    assert (
        client.post(
            "/auth/enroll/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]},
        ).status_code
        == 401
    )
    clear_windows(client)
    grant = prove(client, environment)
    environment[1][0] += 300
    assert complete(client, grant).status_code == 401
    assert len(client.app.state.accounts.list_users()) == 1


def test_resend_keeps_approved_recipient_and_verified_grants_survive(client, environment):
    approve(client, environment)
    challenge = begin(client)
    oldcode = environment[0][-1][1]
    payload = {"challenge_id": challenge["challenge_id"], "email": "attacker@example.com"}
    assert client.post("/auth/enroll/resend", headers=HEADERS, json=payload).status_code == 429
    clear_windows(client)
    response = client.post("/auth/enroll/resend", headers=HEADERS, json=payload)
    assert response.status_code == 200 and environment[0][-1][0] == EMAIL
    assert (
        client.post(
            "/auth/enroll/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": oldcode},
        ).status_code
        == 401
    )
    response = client.post(
        "/auth/enroll/verify",
        headers=HEADERS,
        json={"challenge_id": response.json()["challenge_id"], "code": environment[0][-1][1]},
    )
    grant = response.json()["setup_grant"]
    clear_windows(client)
    begin(client)
    assert complete(client, grant).status_code == 200


def test_proof_is_single_use_and_separated_from_signin_and_admin_setup(client, environment):
    approve(client, environment)
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]}
    assert client.post("/auth/mfa/verify", headers=HEADERS, json=payload).status_code == 401
    response = client.post("/auth/enroll/verify", headers=HEADERS, json=payload)
    assert response.status_code == 200 and "ic_session" not in client.cookies
    assert client.post("/auth/enroll/verify", headers=HEADERS, json=payload).status_code == 401
    grant = response.json()["setup_grant"]
    assert (
        client.post(
            "/auth/setup/complete", headers=HEADERS, json={**MEMBER, "setup_grant": grant}
        ).status_code
        == 409
    )
    assert complete(client, grant).status_code == 200


def test_username_conflicts_and_bad_passwords_do_not_consume_approval(client, environment):
    approve(client, environment)
    grant = prove(client, environment)
    assert complete(client, grant, username=ADMIN["username"]).status_code == 409
    assert complete(client, grant, username="bad name").status_code == 422
    assert complete(client, grant, password="short").status_code == 422
    assert len(client.app.state.accounts.list_users()) == 1
    assert complete(client, grant).status_code == 200


def test_concurrent_completions_create_one_account(client, environment):
    approve(client, environment)
    first = prove(client, environment)
    clear_windows(client)
    second = prove(client, environment)
    service = client.app.state.accounts.enrollment

    def attempt(item):
        try:
            return service.complete(item[0], item[1], MEMBER["password"])["id"]
        except HTTPException as exc:
            assert exc.status_code == 401
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [(first, "first-member"), (second, "second-member")]))
    assert sum(value is not None for value in results) == 1
    assert len(client.app.state.accounts.list_users()) == 2


def test_delivery_failure_leaves_approval_but_no_valid_code(client, environment, monkeypatch):
    approve(client, environment)
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda *_: (_ for _ in ()).throw(HTTPException(503, "Mail unavailable")),
    )
    assert (
        client.post("/auth/enroll/start", headers=HEADERS, json={"email": EMAIL}).status_code == 503
    )
    assert len(client.app.state.accounts.enrollment.list_approvals()) == 1
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM enrollment_codes").fetchone()[0] == 0


def test_enrollment_requires_csrf_and_validation_does_not_echo_secrets(client):
    for action in ("start", "resend", "verify", "complete"):
        assert client.post("/auth/enroll/" + action, json={}).status_code == 403
    sensitive = "private-secret-input" * 40
    response = complete(client, sensitive)
    assert response.status_code == 422 and sensitive not in response.text


def test_stale_admin_session_cannot_approve_or_revoke_inside_transaction(client, environment):
    from api.auth import verify_session_token

    approval, token = approve(client, environment)
    accounts = client.app.state.accounts
    claims = verify_session_token(token)
    admin = accounts.authenticate(ADMIN["username"], ADMIN["password"])
    accounts.end_session(claims["session_id"])
    for mutation in (
        lambda: accounts.enrollment.approve(
            "later@example.com", actor=admin["id"], actor_session=claims["session_id"]
        ),
        lambda: accounts.enrollment.revoke(
            approval["id"], actor=admin["id"], actor_session=claims["session_id"]
        ),
    ):
        with pytest.raises(HTTPException) as rejected:
            mutation()
        assert rejected.value.status_code == 403
    assert accounts.enrollment.list_approvals()[0]["id"] == approval["id"]


def test_enrollment_storage_is_hashed_restart_safe_and_portable(session_store, environment):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    owner = accounts.create_user(
        ADMIN["username"], ADMIN["password"], "admin", email="owner@example.com"
    )
    challenge = accounts.mfa.begin(owner)
    import pyotp

    from api.authenticator import now_seconds

    setup = accounts.mfa.verify(challenge["challenge_id"], environment[0][-1][1])
    user, _ = accounts.mfa.verify(
        setup["challenge_id"], pyotp.TOTP(setup["secret"]).at(now_seconds())
    )
    sid, _ = accounts.create_session(user, 3600, mfa_verified=True)
    accounts.enrollment.approve(EMAIL, actor=user["id"], actor_session=sid)
    challenge = accounts.enrollment.start(EMAIL)
    with accounts.connect() as db:
        row = accounts.execute(db, f"SELECT * FROM {accounts.table('enrollment_codes')}").fetchone()
        assert row["id"] != challenge["challenge_id"] and len(row["id"]) == 64
        assert row["code_hash"] != environment[0][-1][1] and len(row["code_hash"]) == 64
    restarted = Accounts(session_store)
    proof = restarted.enrollment.verify(challenge["challenge_id"], environment[0][-1][1])
    with accounts.connect() as db:
        row = accounts.execute(
            db, f"SELECT * FROM {accounts.table('enrollment_grants')}"
        ).fetchone()
        assert row["id"] != proof["setup_grant"] and len(row["id"]) == 64
    member = restarted.enrollment.complete(
        proof["setup_grant"], MEMBER["username"], MEMBER["password"]
    )
    import pyotp

    setup = restarted.mfa.enroll(member)
    member, _ = restarted.mfa.verify(setup["challenge_id"], pyotp.TOTP(setup["secret"]).now())
    sid, expiry = restarted.create_session(member, 3600, mfa_verified=True)
    assert restarted.session_claims(sid, member["username"], expiry)["workspace_id"] == member["id"]
