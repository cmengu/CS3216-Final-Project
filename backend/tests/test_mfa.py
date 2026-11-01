"""Real mandatory MFA policy, without password-regression mocks or paid providers."""

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor

import pyotp
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, DATA, HEADERS, MEMBER

from api.app import create_app
from api.auth import create_session_token
from api.mfa import CHALLENGE_SECONDS, now_seconds
from api.stages import FixtureStages

pytestmark = pytest.mark.mfa


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
    assert response.json()["mfa_required"] is True
    assert "session_id" not in response.json() and "user" not in response.json()
    assert "ic_session" not in client.cookies
    return response.json()


def verify(client, challenge, code):
    return client.post(
        "/auth/mfa/verify",
        headers=HEADERS,
        json={"challenge_id": challenge["challenge_id"], "code": code},
    )


def enroll(client, credentials=ADMIN):
    challenge = start(client, credentials)
    secret = challenge["enrollment"]["secret"]
    response = verify(client, challenge, pyotp.TOTP(secret).at(now_seconds()))
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["recovery_codes"]) == 10
    return result, secret


def test_first_administrator_setup_does_not_grant_access_before_totp(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    token = "isolated-first-admin-mfa-setup-token-2026"
    monkeypatch.setenv("AUTH_SETUP_TOKEN", token)
    app = create_app(storage_dir=tmp_path, start_worker=False)
    with TestClient(app) as client:
        response = client.post("/auth/setup", headers=HEADERS, json={**ADMIN, "token": token})
        assert response.status_code == 200, response.text
        challenge = response.json()
        assert challenge["enrollment"]["qr_code"].startswith("data:image/png;base64,")
        assert "session_id" not in challenge and "ic_session" not in client.cookies
        assert client.get("/admin/accounts").status_code == 401
        assert client.get("/invoices").status_code == 401
        # Abandoning the setup page is recoverable by signing in with the chosen password.
        challenge = start(client)
        secret = challenge["enrollment"]["secret"]
        verified = verify(client, challenge, pyotp.TOTP(secret).at(now_seconds()))
        assert verified.status_code == 200
        assert client.get("/admin/accounts").status_code == 200
        with app.state.accounts.connect() as db:
            factor = dict(db.execute("SELECT * FROM account_mfa").fetchone())
            assert secret not in json.dumps(factor)
            assert all(
                value not in factor["recovery"] for value in verified.json()["recovery_codes"]
            )


def test_every_approved_member_requires_enrollment_and_private_verified_session(app):
    with TestClient(app) as client:
        admin, _ = enroll(client)
        member = client.post("/admin/accounts", headers=HEADERS, json=MEMBER)
        assert member.status_code == 201
        challenge = start(client, MEMBER)
        assert client.get("/projects").status_code == 401
        assert verify(client, challenge, "invalid").status_code == 401
        result = verify(
            client, challenge, pyotp.TOTP(challenge["enrollment"]["secret"]).at(now_seconds())
        )
        assert result.status_code == 200
        assert result.json()["user"]["id"] != admin["user"]["id"]
        assert client.get("/admin/accounts").status_code == 403
        assert client.get("/projects").json() == []


def test_invalid_codes_expire_and_attempts_commit(app, clock):
    with TestClient(app) as client:
        challenge = start(client)
        code = pyotp.TOTP(challenge["enrollment"]["secret"]).at(clock[0])
        for _ in range(5):
            assert verify(client, challenge, "not-a-code").status_code == 401
        refused = verify(client, challenge, code)
        assert refused.status_code == 401 and "expired" in refused.json()["detail"]
        with app.state.accounts.connect() as db:
            row = db.execute(
                "SELECT attempts FROM mfa_challenges WHERE id=?",
                (hashlib.sha256(challenge["challenge_id"].encode()).hexdigest(),),
            ).fetchone()
            assert row["attempts"] == 5
        fresh = start(client)
        clock[0] += CHALLENGE_SECONDS
        assert (
            verify(
                client, fresh, pyotp.TOTP(fresh["enrollment"]["secret"]).at(clock[0])
            ).status_code
            == 401
        )


def test_successful_challenge_is_single_use_and_totp_cannot_replay(app, clock):
    with TestClient(app) as client:
        result, secret = enroll(client)
        challenge = start(client)
        assert challenge["enrollment"] is None
        assert verify(client, challenge, pyotp.TOTP(secret).at(clock[0])).status_code == 401
        clock[0] += 30
        accepted = verify(client, challenge, pyotp.TOTP(secret).at(clock[0]))
        assert accepted.status_code == 200 and "recovery_codes" not in accepted.json()
        assert verify(client, challenge, pyotp.TOTP(secret).at(clock[0])).status_code == 401
        assert client.get("/auth/me").json()["user"]["id"] == result["user"]["id"]


def test_recovery_codes_are_single_use_and_atomic_across_concurrent_challenges(app):
    with TestClient(app) as client:
        result, _ = enroll(client)
        accounts = app.state.accounts
        user = accounts.get_user(result["user"]["id"])
        challenges = [accounts.mfa.begin(user) for _ in range(2)]

        def attempt(challenge):
            try:
                accounts.mfa.verify(challenge["challenge_id"], result["recovery_codes"][0])
                return True
            except HTTPException:
                return False

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(attempt, challenges)).count(True) == 1
        challenge = start(client)
        assert verify(client, challenge, result["recovery_codes"][0]).status_code == 401
        assert (
            verify(
                client, challenge, result["recovery_codes"][1].lower().replace("-", "")
            ).status_code
            == 200
        )
        assert client.get("/auth/mfa/status").json()["recovery_remaining"] == 8


def test_password_reset_never_removes_mfa_and_invalidates_pending_challenges(app):
    with TestClient(app) as client:
        result, _ = enroll(client)
        pending = start(client)
        user_id = result["user"]["id"]
        other = app.state.accounts.create_user(
            "second-admin", "another-private-admin-password", "admin"
        )
        app.state.accounts.update_user(
            user_id, actor=other["id"], password="replacement-private-password-2026"
        )
        assert verify(client, pending, result["recovery_codes"][0]).status_code == 401
        new = start(client, {**ADMIN, "password": "replacement-private-password-2026"})
        assert new["enrollment"] is None
        assert verify(client, new, result["recovery_codes"][0]).status_code == 200
        client.cookies.clear()
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + result["session_id"]}
            ).status_code
            == 401
        )


def test_replacing_authenticator_requires_both_factors_and_revokes_old_codes_and_sessions(app):
    with TestClient(app) as client:
        original, secret = enroll(client)
        assert (
            client.post(
                "/auth/mfa/replace",
                headers=HEADERS,
                json={"password": "wrong", "code": original["recovery_codes"][0]},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/auth/mfa/replace",
                headers=HEADERS,
                json={"password": ADMIN["password"], "code": "invalid"},
            ).status_code
            == 401
        )
        response = client.post(
            "/auth/mfa/replace",
            headers=HEADERS,
            json={"password": ADMIN["password"], "code": original["recovery_codes"][0]},
        )
        assert response.status_code == 200
        challenge = response.json()
        new_secret = challenge["enrollment"]["secret"]
        assert secret != new_secret
        result = verify(client, challenge, pyotp.TOTP(new_secret).at(now_seconds()))
        assert result.status_code == 200
        client.cookies.clear()
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + original["session_id"]}
            ).status_code
            == 401
        )
        challenge = start(client)
        assert verify(client, challenge, original["recovery_codes"][1]).status_code == 401
        assert verify(client, challenge, result.json()["recovery_codes"][0]).status_code == 200


def test_registered_password_only_sessions_cannot_bypass_mfa(app):
    with TestClient(app) as client:
        user = app.state.accounts.authenticate(ADMIN["username"], ADMIN["password"])
        with pytest.raises(HTTPException):
            app.state.accounts.create_session(user, 3600)
        with app.state.accounts.connect() as db:
            db.execute(
                "INSERT INTO account_sessions (id,user_id,version,expires_at) VALUES (?,?,?,?)",
                ("old-password-session", user["id"], user["version"], int(time.time()) + 3600),
            )
        token = create_session_token(ADMIN["username"], "old-password-session")
        assert (
            client.get("/invoices", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
        assert (
            client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        )


def test_challenge_is_bound_to_account_version_and_disable_invalidates_it(app):
    with TestClient(app) as client:
        original, _ = enroll(client)
        pending = start(client)
        other = app.state.accounts.create_user(
            "second-admin", "another-private-admin-password", "admin"
        )
        app.state.accounts.update_user(original["user"]["id"], actor=other["id"], active=False)
        assert verify(client, pending, original["recovery_codes"][0]).status_code == 401
        app.state.accounts.update_user(original["user"]["id"], actor=other["id"], active=True)
        assert verify(client, pending, original["recovery_codes"][0]).status_code == 401


def test_mfa_verification_requires_csrf_and_never_echoes_secrets(app):
    with TestClient(app) as client:
        challenge = start(client)
        secret = challenge["enrollment"]["secret"]
        code = pyotp.TOTP(secret).at(now_seconds())
        assert (
            client.post(
                "/auth/mfa/verify", json={"challenge_id": challenge["challenge_id"], "code": code}
            ).status_code
            == 403
        )
        invalid = client.post(
            "/auth/mfa/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": secret * 10},
        )
        assert invalid.status_code == 422 and secret not in invalid.text
        assert client.get("/auth/me").status_code == 401


def test_operator_reset_is_audited_and_forces_reenrollment(app):
    with TestClient(app) as client:
        result, _ = enroll(client)
        app.state.accounts.mfa.reset_by_operator(result["user"]["id"])
        assert client.get("/auth/me").status_code == 401
        challenge = start(client)
        assert challenge["enrollment"]
        assert verify(client, challenge, result["recovery_codes"][0]).status_code == 401
        with app.state.accounts.connect() as db:
            assert db.execute(
                "SELECT 1 FROM account_events WHERE action='mfa_reset_operator'"
            ).fetchone()


def test_pending_enrollment_and_recovery_survive_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        challenge = start(client)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        result = verify(
            client, challenge, pyotp.TOTP(challenge["enrollment"]["secret"]).at(now_seconds())
        )
        assert result.status_code == 200
        codes = result.json()["recovery_codes"]
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        challenge = start(client)
        assert verify(client, challenge, codes[0]).status_code == 200


def test_postgres_and_sqlite_mfa_sessions_require_verified_proof(session_store):
    from api.accounts import Accounts

    accounts = Accounts(session_store)
    user = accounts.create_user("mfa-member", "isolated-mfa-member-password-2026", "member")
    challenge = accounts.mfa.begin(user)
    verified, codes = accounts.mfa.verify(
        challenge["challenge_id"], pyotp.TOTP(challenge["enrollment"]["secret"]).at(now_seconds())
    )
    sid, expires = accounts.create_session(verified, 3600, mfa_verified=True)
    assert (
        accounts.session_claims(sid, user["username"], expires)["workspace_id"]
        == user["workspace_id"]
    )
    accounts.mfa.reset_by_operator(user["id"])
    assert accounts.session_claims(sid, user["username"], expires) is None
    pending = accounts.mfa.begin(accounts.get_user(user["id"]))
    with pytest.raises(HTTPException):
        accounts.mfa.verify(pending["challenge_id"], codes[0])


def test_mfa_attempt_allowance_is_shared_across_password_challenges(app):
    with TestClient(app) as client:
        for _ in range(3):
            challenge = start(client)
            for _ in range(5):
                assert verify(client, challenge, "invalid").status_code == 401
        challenge = start(client)
        response = verify(
            client, challenge, pyotp.TOTP(challenge["enrollment"]["secret"]).at(now_seconds())
        )
        assert response.status_code == 429 and response.headers["Retry-After"]


def test_clock_skew_is_small_and_each_accepted_counter_is_consumed(app, clock):
    with TestClient(app) as client:
        challenge = start(client)
        otp = pyotp.TOTP(challenge["enrollment"]["secret"])
        assert verify(client, challenge, otp.at(clock[0] - 90)).status_code == 401
        assert verify(client, challenge, otp.at(clock[0] - 30)).status_code == 200
        challenge = start(client)
        assert verify(client, challenge, otp.at(clock[0] - 30)).status_code == 401
        assert verify(client, challenge, otp.at(clock[0])).status_code == 200
