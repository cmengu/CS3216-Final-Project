"""Recovery needs registered-inbox proof and never bypasses account access or email MFA."""

import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, MEMBER
from test_mfa import login, verify_login

from api import security_mail
from api.app import create_app

pytestmark = pytest.mark.mfa
OWNER = "owner@example.com"
EMAIL = "member@example.com"
NEW_PASSWORD = "my-recovered-private-password-2026"


@pytest.fixture
def environment(monkeypatch):
    messages, clock = [], [int(time.time())]
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("RESEND_API_KEY", "re_fake_reset_test_key_never_sent")
    monkeypatch.delenv("AUTH_EMAIL_TEST_RECIPIENT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda recipient, code, delivery: messages.append((recipient, code, delivery)),
    )
    monkeypatch.setattr("api.password_reset.now_seconds", lambda: clock[0])
    return messages, clock


@pytest.fixture
def client(environment, tmp_path):
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        client.app.state.accounts.create_user(
            MEMBER["username"], MEMBER["password"], "member", email=EMAIL
        )
        yield client


def begin(client, email=EMAIL):
    response = client.post("/auth/password-reset/start", headers=HEADERS, json={"email": email})
    assert response.status_code == 200, response.text
    return response.json()


def prove(client, environment, email=EMAIL):
    challenge = begin(client, email)
    response = client.post(
        "/auth/password-reset/verify",
        headers=HEADERS,
        json={"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]},
    )
    assert response.status_code == 200, response.text
    return response.json()["reset_grant"]


def complete(client, grant, **values):
    return client.post(
        "/auth/password-reset/complete",
        headers=HEADERS,
        json={"reset_grant": grant, "new_password": NEW_PASSWORD, **values},
    )


def clear_windows(client):
    with client.app.state.store.connect() as db:
        db.execute("DELETE FROM request_limits")


@pytest.mark.parametrize("use_email", [False, True])
@pytest.mark.parametrize("credentials,email", [(ADMIN, OWNER), (MEMBER, EMAIL)])
def test_reset_revokes_all_sessions_preserves_workspace_and_requires_new_login(
    client, environment, credentials, email, use_email
):
    first = login(client, environment[0], credentials)
    clear_windows(client)
    second = login(client, environment[0], credentials)
    uid = first["user"]["id"]
    accounts = client.app.state.accounts
    before = accounts.get_user(uid)
    store = client.app.state.store
    store.insert(
        "private-reset-invoice",
        "private.pdf",
        "private-reset-hash",
        "fixture",
        "v1",
        session_id=uid,
    )
    store.update("private-reset-invoice", "failed", error="reading: synthetic")
    grant = prove(client, environment, email)
    assert environment[0][-1][0] == email
    # Sending/verifying a reset must not sign out or change existing credentials.
    assert client.get("/auth/me").status_code == 200
    assert accounts.authenticate(credentials["username"], credentials["password"])
    response = complete(client, grant)
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert "ic_session" not in client.cookies and client.get("/auth/me").status_code == 401
    for token in (first["session_id"], second["session_id"]):
        assert (
            client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
    assert not accounts.authenticate(credentials["username"], credentials["password"])
    after = accounts.authenticate(credentials["username"], NEW_PASSWORD)
    assert (
        after["id"] == uid
        and after["workspace_id"] == before["workspace_id"]
        and after["role"] == before["role"]
    )
    assert NEW_PASSWORD not in after["password_hash"]
    assert store.get("private-reset-invoice", session_id=uid)
    assert complete(client, grant).status_code == 401
    clear_windows(client)
    challenge = client.post(
        "/auth/sign-in",
        headers=HEADERS,
        json={
            "username": email if use_email else credentials["username"],
            "password": NEW_PASSWORD,
        },
    ).json()
    assert challenge["mfa_required"] and "session_id" not in challenge
    assert client.get("/invoices").status_code == 401
    assert challenge["method"] == "totp"
    assert verify_login(client, challenge).status_code == 200
    assert client.get("/invoices").json()[0]["id"] == "private-reset-invoice"


def test_unknown_disabled_and_pending_addresses_never_reset_or_create_accounts(client, environment):
    accounts = client.app.state.accounts
    member = accounts.authenticate(MEMBER["username"], MEMBER["password"])
    owner = accounts.authenticate(ADMIN["username"], ADMIN["password"])
    accounts.update_user(member["id"], actor=owner["id"], active=False)
    admin_login = login(client, environment[0])
    assert (
        client.post(
            "/admin/accounts", headers=HEADERS, json={"email": "pending@example.com"}
        ).status_code
        == 201
    )
    client.cookies.clear()
    count = len(environment[0])
    for email in ("stranger@example.com", EMAIL, "pending@example.com"):
        challenge = begin(client, email)
        assert len(environment[0]) == count
        assert set(challenge) == {
            "mfa_required",
            "challenge_id",
            "destination",
            "expires_in",
            "resend_after",
        }
        assert (
            client.post(
                "/auth/password-reset/verify",
                headers=HEADERS,
                json={"challenge_id": challenge["challenge_id"], "code": "000000"},
            ).status_code
            == 401
        )
    assert len(accounts.list_users()) == 2 and not accounts.get_user(member["id"])["active"]
    assert (
        client.get(
            "/auth/me", headers={"Authorization": "Bearer " + admin_login["session_id"]}
        ).status_code
        == 200
    )


def test_unverified_password_work_and_recipient_or_role_rewrites_are_rejected(
    client, environment, monkeypatch
):
    with monkeypatch.context() as scope:
        scope.setattr(
            "api.password_reset.hash_password", lambda *_: pytest.fail("Unverified hashing")
        )
        assert (
            complete(client, "unverified-reset-proof-longer-than-32-characters").status_code == 401
        )
    assert (
        client.post(
            "/auth/password-reset/start",
            headers=HEADERS,
            json={"email": EMAIL, "username": ADMIN["username"]},
        ).status_code
        == 422
    )
    grant = prove(client, environment)
    for values in ({"email": OWNER}, {"role": "admin"}, {"user_id": "other-account"}):
        assert complete(client, grant, **values).status_code == 422
    assert complete(client, grant, new_password="short").status_code == 422
    assert complete(client, grant).status_code == 200


def test_attempt_limits_and_code_and_grant_expiration(client, environment):
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": "incorrect"}
    for _ in range(5):
        assert (
            client.post("/auth/password-reset/verify", headers=HEADERS, json=payload).status_code
            == 401
        )
    payload["code"] = environment[0][-1][1]
    assert (
        client.post("/auth/password-reset/verify", headers=HEADERS, json=payload).status_code == 401
    )
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT attempts FROM password_reset_codes").fetchone()[0] == 5
    clear_windows(client)
    challenge = begin(client)
    environment[1][0] += 300
    assert (
        client.post(
            "/auth/password-reset/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]},
        ).status_code
        == 401
    )
    clear_windows(client)
    grant = prove(client, environment)
    environment[1][0] += 300
    assert complete(client, grant).status_code == 401


@pytest.mark.parametrize("verified", [False, True])
@pytest.mark.parametrize("change", ["email", "email-version", "password", "access"])
def test_account_changes_invalidate_reset_proof(client, environment, verified, change):
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]}
    grant = None
    if verified:
        grant = client.post("/auth/password-reset/verify", headers=HEADERS, json=payload).json()[
            "reset_grant"
        ]
    accounts = client.app.state.accounts
    member = accounts.authenticate(MEMBER["username"], MEMBER["password"])
    owner = accounts.authenticate(ADMIN["username"], ADMIN["password"])
    if change == "email":
        accounts.mfa.set_by_operator(member["id"], "changed@example.com")
    elif change == "email-version":
        # Even an inbox-only version change must invalidate an outstanding code/grant.
        with accounts.connect() as db:
            accounts.execute(
                db, "UPDATE account_email SET version=version+1 WHERE user_id=?", (member["id"],)
            )
    elif change == "password":
        accounts.update_user(
            member["id"], actor=owner["id"], password="admin-replaced-password-2026"
        )
    else:
        accounts.update_user(member["id"], actor=owner["id"], active=False)
        accounts.update_user(member["id"], actor=owner["id"], active=True)
    if verified:
        assert complete(client, grant).status_code == 401
    else:
        assert (
            client.post("/auth/password-reset/verify", headers=HEADERS, json=payload).status_code
            == 401
        )
    assert not accounts.authenticate(MEMBER["username"], NEW_PASSWORD)


def test_codes_are_one_use_purpose_separated_and_not_login_sessions(client, environment):
    challenge = begin(client)
    payload = {"challenge_id": challenge["challenge_id"], "code": environment[0][-1][1]}
    for route in ("/auth/mfa/verify", "/auth/enroll/verify", "/auth/setup/verify"):
        assert client.post(route, headers=HEADERS, json=payload).status_code in (401, 409)
    response = client.post("/auth/password-reset/verify", headers=HEADERS, json=payload)
    assert response.status_code == 200 and "session_id" not in response.json()
    assert "ic_session" not in client.cookies and client.get("/auth/me").status_code == 401
    assert (
        client.post("/auth/password-reset/verify", headers=HEADERS, json=payload).status_code == 401
    )
    grant = response.json()["reset_grant"]
    assert (
        client.post(
            "/auth/enroll/complete", headers=HEADERS, json={**MEMBER, "setup_grant": grant}
        ).status_code
        == 401
    )
    assert complete(client, grant).status_code == 200


def test_resend_has_cooldown_preserves_recipient_and_retires_old_challenge(client, environment):
    challenge = begin(client)
    original = environment[0][-1][1]
    payload = {"challenge_id": challenge["challenge_id"], "email": "attacker@example.com"}
    assert (
        client.post("/auth/password-reset/resend", headers=HEADERS, json=payload).status_code == 429
    )
    clear_windows(client)
    resent = client.post("/auth/password-reset/resend", headers=HEADERS, json=payload)
    assert resent.status_code == 200 and environment[0][-1][0] == EMAIL
    assert (
        client.post(
            "/auth/password-reset/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": original},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/password-reset/verify",
            headers=HEADERS,
            json={"challenge_id": resent.json()["challenge_id"], "code": environment[0][-1][1]},
        ).status_code
        == 200
    )


def test_new_requests_cannot_invalidate_verified_recovery_and_completions_cannot_race(
    client, environment
):
    first = prove(client, environment)
    clear_windows(client)
    second = prove(client, environment)
    clear_windows(client)
    begin(client)

    def attempt(item):
        try:
            return client.app.state.accounts.password_reset.complete(item[0], item[1])["ok"]
        except HTTPException as exc:
            assert exc.status_code == 401
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(attempt, [(first, NEW_PASSWORD), (second, "other-concurrent-password-2026")])
        )
    assert sum(results) == 1


def test_delivery_failure_does_not_change_password_or_leave_valid_code(
    client, environment, monkeypatch
):
    token = login(client, environment[0], MEMBER)["session_id"]
    monkeypatch.setattr(
        security_mail,
        "send_code",
        lambda *_: (_ for _ in ()).throw(HTTPException(503, "Delivery failed")),
    )
    response = client.post("/auth/password-reset/start", headers=HEADERS, json={"email": EMAIL})
    assert response.status_code == 503
    assert client.app.state.accounts.authenticate(MEMBER["username"], MEMBER["password"])
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 200
    with client.app.state.store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM password_reset_codes").fetchone()[0] == 0


def test_reset_cannot_bypass_restricted_test_sender(client, environment, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("AUTH_EMAIL_TEST_RECIPIENT", OWNER)
    before = len(environment[0])
    assert (
        client.post(
            "/auth/password-reset/start", headers=HEADERS, json={"email": EMAIL}
        ).status_code
        == 503
    )
    assert len(environment[0]) == before


def test_csrf_origin_validation_and_ip_limit_apply_before_parsing(client):
    for action in ("start", "verify", "resend", "complete"):
        assert client.post("/auth/password-reset/" + action, json={}).status_code == 403
        assert (
            client.post(
                "/auth/password-reset/" + action,
                headers={**HEADERS, "Origin": "https://attacker.example"},
                json={},
            ).status_code
            == 403
        )
    for _ in range(20):
        response = client.post(
            "/auth/password-reset/start",
            headers={**HEADERS, "Content-Type": "application/json"},
            content="invalid-json",
        )
        assert response.status_code == 422
    response = client.post("/auth/password-reset/start", headers=HEADERS, json={"email": EMAIL})
    assert response.status_code == 429 and "Retry-After" in response.headers


def test_sensitive_validation_input_is_not_echoed_and_failure_does_not_sign_out(
    client, environment
):
    login(client, environment[0], MEMBER)
    secret = "private-reset-value" * 40
    response = complete(client, secret)
    assert response.status_code == 422 and secret not in response.text
    assert client.get("/auth/me").status_code == 200


def test_pending_login_challenges_and_other_reset_grants_are_invalidated_on_success(
    client, environment
):
    pending = client.post("/auth/sign-in", headers=HEADERS, json=MEMBER).json()
    login_code = environment[0][-1][1]
    grant = prove(client, environment)
    clear_windows(client)
    other = prove(client, environment)
    assert complete(client, grant).status_code == 200
    assert complete(client, other).status_code == 401
    assert (
        client.post(
            "/auth/mfa/verify",
            headers=HEADERS,
            json={"challenge_id": pending["challenge_id"], "code": login_code},
        ).status_code
        == 401
    )


def test_reset_storage_is_hashed_restart_safe_and_portable(session_store, environment):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    user = accounts.create_user(MEMBER["username"], MEMBER["password"], "member", email=EMAIL)
    challenge = accounts.password_reset.start(EMAIL)
    with accounts.connect() as db:
        stored = accounts.execute(
            db, f"SELECT * FROM {accounts.table('password_reset_codes')}"
        ).fetchone()
        assert stored["id"] != challenge["challenge_id"] and len(stored["id"]) == 64
        assert stored["code_hash"] != environment[0][-1][1]
    restarted = Accounts(session_store)
    proof = restarted.password_reset.verify(challenge["challenge_id"], environment[0][-1][1])
    with accounts.connect() as db:
        stored = accounts.execute(
            db, f"SELECT * FROM {accounts.table('password_reset_grants')}"
        ).fetchone()
        assert stored["id"] != proof["reset_grant"] and len(stored["id"]) == 64
    assert restarted.password_reset.complete(proof["reset_grant"], NEW_PASSWORD) == {"ok": True}
    assert (
        restarted.authenticate(MEMBER["username"], NEW_PASSWORD)["workspace_id"]
        == user["workspace_id"]
    )


def test_recovery_does_not_change_other_users_passwords_sessions_or_workspace(client, environment):
    owner_login = login(client, environment[0])
    client.cookies.clear()
    member_login = login(client, environment[0], MEMBER)
    grant = prove(client, environment)
    assert complete(client, grant).status_code == 200
    assert (
        client.get(
            "/auth/me", headers={"Authorization": "Bearer " + owner_login["session_id"]}
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/auth/me", headers={"Authorization": "Bearer " + member_login["session_id"]}
        ).status_code
        == 401
    )
    assert client.app.state.accounts.authenticate(ADMIN["username"], ADMIN["password"])
