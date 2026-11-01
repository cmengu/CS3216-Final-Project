"""TOTP confidentiality, replay protection, recovery and migration boundaries."""

from concurrent.futures import ThreadPoolExecutor

import pyotp
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN
from test_mfa import app as _app
from test_mfa import clock as _clock
from test_mfa import cooldown, login, raw_verify, start, verify_login
from test_mfa import mail as _mail

from api import security_mail
from api.accounts import Accounts
from api.app import create_app
from api.auth import create_session_token
from api.authenticator import now_seconds

app = _app
clock = _clock
mail = _mail

pytestmark = pytest.mark.mfa


def setup_challenge(client, mail):
    email = start(client)
    response = raw_verify(client, email, mail[-1][1])
    assert response.status_code == 200 and response.json()["method"] == "totp_setup"
    assert "ic_session" not in client.cookies
    assert client.get("/admin/accounts").status_code == 401
    return response.json()


def test_email_proof_alone_never_grants_access_and_secrets_are_encrypted(app, mail):
    with TestClient(app) as client:
        challenge = setup_challenge(client, mail)
        assert challenge["qr_code"].startswith("data:image/svg+xml;base64,")
        with app.state.accounts.connect() as db:
            row = db.execute("SELECT * FROM authenticator_challenges").fetchone()
            assert row["id"] != challenge["challenge_id"] and len(row["id"]) == 64
            assert challenge["secret"] not in row["secret"]
            assert db.execute("SELECT COUNT(*) FROM authenticator_factors").fetchone()[0] == 0
        response = raw_verify(client, challenge, pyotp.TOTP(challenge["secret"]).now())
        assert response.status_code == 200
        codes = response.json()["recovery_codes"]
        assert len(codes) == len(set(codes)) == 10
        assert client.get("/admin/accounts").status_code == 200
        assert "recovery_codes" not in client.get("/auth/me").json()
        with app.state.accounts.connect() as db:
            stored = db.execute("SELECT secret FROM authenticator_factors").fetchone()[0]
            assert challenge["secret"] not in stored
            hashes = [row[0] for row in db.execute("SELECT code_hash FROM authenticator_recovery")]
            assert all(code not in hashes for code in codes)


def test_later_login_does_not_send_email_even_if_delivery_is_unavailable(app, mail, monkeypatch):
    with TestClient(app) as client:
        login(client, mail)
        previous = len(mail)
        monkeypatch.setattr(
            security_mail, "send_code", lambda *_: pytest.fail("TOTP login sent email")
        )
        monkeypatch.delenv("RESEND_API_KEY")
        challenge = start(client)
        assert challenge["method"] == "totp"
        assert "secret" not in challenge and "qr_code" not in challenge
        assert verify_login(client, challenge).status_code == 200 and len(mail) == previous


def test_totp_cannot_be_replayed_in_another_challenge(app, mail, clock):
    with TestClient(app) as client:
        setup = setup_challenge(client, mail)
        code = pyotp.TOTP(setup["secret"]).at(clock[0])
        assert raw_verify(client, setup, code).status_code == 200
        challenge = start(client)
        assert raw_verify(client, challenge, code).status_code == 401
        clock[0] += 30
        assert (
            raw_verify(client, challenge, pyotp.TOTP(setup["secret"]).at(clock[0])).status_code
            == 200
        )


def test_recovery_code_is_single_use_under_concurrent_verification(app, mail):
    with TestClient(app) as client:
        result = login(client, mail)
        challenge = start(client)
        code = result["recovery_codes"][0]

        def attempt(_):
            try:
                app.state.accounts.mfa.verify(challenge["challenge_id"], code)
                return True
            except HTTPException:
                return False

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(attempt, range(2))).count(True) == 1
        pending = start(client)
        assert raw_verify(client, pending, code).status_code == 401
        assert raw_verify(client, pending, result["recovery_codes"][1]).status_code == 200


def test_bad_totp_attempts_are_persisted_and_setup_expires(app, mail, clock):
    with TestClient(app) as client:
        setup = setup_challenge(client, mail)
        for _ in range(5):
            assert raw_verify(client, setup, "invalid").status_code == 401
        assert (
            raw_verify(client, setup, pyotp.TOTP(setup["secret"]).at(clock[0])).status_code == 401
        )
        with app.state.accounts.connect() as db:
            assert db.execute("SELECT attempts FROM authenticator_challenges").fetchone()[0] == 5
        cooldown(app)
        setup = setup_challenge(client, mail)
        clock[0] += 300
        assert (
            raw_verify(client, setup, pyotp.TOTP(setup["secret"]).at(clock[0])).status_code == 401
        )


def test_consumed_setup_cannot_be_replayed_or_replace_an_existing_factor(app, mail):
    with TestClient(app) as client:
        setup = setup_challenge(client, mail)
        code = pyotp.TOTP(setup["secret"]).now()
        assert raw_verify(client, setup, code).status_code == 200
        assert raw_verify(client, setup, code).status_code == 401
        with pytest.raises(HTTPException):
            app.state.accounts.mfa.enroll(app.state.accounts.authenticate(**ADMIN))


def test_old_email_sessions_cannot_survive_migration(app):
    with TestClient(app) as client:
        user = app.state.accounts.authenticate(**ADMIN)
        with app.state.accounts.connect() as db:
            db.execute("UPDATE account_email SET verified=1 WHERE user_id=?", (user["id"],))
            db.execute(
                "INSERT INTO account_sessions VALUES (?,?,?,?)",
                ("legacy-session", user["id"], user["version"], now_seconds() + 3600),
            )
            db.execute("INSERT INTO email_verified_sessions VALUES ('legacy-session')")
        token = create_session_token(ADMIN["username"], "legacy-session")
        assert (
            client.get("/invoices", headers={"Authorization": "Bearer " + token}).status_code == 401
        )
        with pytest.raises(HTTPException):
            app.state.accounts.create_session(user, 3600, mfa_verified=True)


def test_operator_reset_revokes_old_sessions_recovery_and_pending_setup(app, mail):
    with TestClient(app) as client:
        result = login(client, mail)
        pending = start(client)
        app.state.accounts.mfa.reset_by_operator(result["user"]["id"])
        assert raw_verify(client, pending, result["recovery_codes"][0]).status_code == 401
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + result["session_id"]}
            ).status_code
            == 401
        )
        assert not app.state.accounts.mfa.authenticator.enrolled(result["user"]["id"])
        cooldown(app)
        assert start(client)["method"] == "email_enrollment"


def test_pending_authenticator_setup_survives_restart(tmp_path, monkeypatch, mail):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        challenge = setup_challenge(client, mail)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        assert (
            raw_verify(client, challenge, pyotp.TOTP(challenge["secret"]).now()).status_code == 200
        )


def test_wrong_encryption_key_fails_closed(app, mail, monkeypatch):
    with TestClient(app) as client:
        login(client, mail)
        challenge = start(client)
        monkeypatch.setenv("AUTH_MFA_KEY", "different-persistent-encryption-key-for-testing")
        response = raw_verify(client, challenge, "123456")
        assert response.status_code == 503 and client.get("/auth/me").status_code == 401


def test_authenticator_and_recovery_storage_are_portable(session_store, mail):
    accounts = Accounts(session_store)
    owner = accounts.create_user(
        "portable-totp", "isolated-portable-test-password", "member", email="member@example.com"
    )
    email = accounts.mfa.begin(owner)
    setup = accounts.mfa.verify(email["challenge_id"], mail[-1][1])
    user, codes = accounts.mfa.verify(setup["challenge_id"], pyotp.TOTP(setup["secret"]).now())
    sid, expires = accounts.create_session(user, 3600, mfa_verified=True)
    restarted = Accounts(session_store)
    assert (
        restarted.session_claims(sid, user["username"], expires)["workspace_id"]
        == user["workspace_id"]
    )
    challenge = restarted.mfa.begin(user)
    assert restarted.mfa.verify(challenge["challenge_id"], codes[0])[0]["id"] == user["id"]
