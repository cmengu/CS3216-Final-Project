"""Gmail uses validated TLS and registered recipients, with no real network delivery."""

import re
import smtplib
import ssl

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_accounts import ADMIN, HEADERS, MEMBER

from api import security_mail
from api.app import create_app

pytestmark = pytest.mark.mfa
SENDER = "sender@gmail.com"
OWNER = "owner@example.com"
EMAIL = "member@example.com"


@pytest.fixture
def gmail(monkeypatch):
    captured = {"connections": [], "logins": [], "messages": []}
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "gmail")
    monkeypatch.setenv("GMAIL_SMTP_USER", SENDER)
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setattr(
        security_mail.httpx, "post", lambda *_a, **_k: pytest.fail("Gmail fell back to Resend")
    )

    class SMTP:
        def __init__(self, *args, **kwargs):
            captured["connections"].append((args, kwargs))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def login(self, username, password):
            captured["logins"].append((username, password))

        def send_message(self, message, **kwargs):
            captured["messages"].append((message, kwargs))
            return {}

    monkeypatch.setattr(security_mail.smtplib, "SMTP_SSL", SMTP)
    return captured


def code(gmail):
    return re.search(r"\b\d{6}\b", gmail["messages"][-1][0].get_content()).group()


def test_gmail_can_send_to_other_providers_with_fixed_tls_and_no_recipient_rewrite(gmail):
    assert security_mail.configured()
    security_mail.ensure_ready(OWNER)
    security_mail.send_code(OWNER, "123456", "synthetic-delivery")
    args, kwargs = gmail["connections"][0]
    assert args == ("smtp.gmail.com", 465) and kwargs["timeout"] == 10
    assert kwargs["context"].check_hostname and kwargs["context"].verify_mode == ssl.CERT_REQUIRED
    assert gmail["logins"] == [(SENDER, "abcdefghijklmnop")]
    message, envelope = gmail["messages"][0]
    assert message["From"] == SENDER and message["To"] == OWNER
    assert envelope == {"from_addr": SENDER, "to_addrs": [OWNER]}
    assert "123456" in message.get_content() and "abcdefghijklmnop" not in message.as_string()


@pytest.mark.parametrize(
    "key,value",
    [
        ("GMAIL_APP_PASSWORD", ""),
        ("GMAIL_APP_PASSWORD", "short"),
        ("GMAIL_SMTP_USER", "not-an-email"),
        ("GMAIL_SMTP_USER", "sender@outlook.com"),
        ("AUTH_EMAIL_PROVIDER", "unknown"),
    ],
)
def test_invalid_gmail_settings_do_not_connect_or_fall_back(gmail, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    assert not security_mail.configured()
    with pytest.raises(HTTPException) as failure:
        security_mail.send_code(OWNER, "123456", "delivery")
    assert failure.value.status_code == 503 and not gmail["connections"]


@pytest.mark.parametrize(
    "error",
    [
        smtplib.SMTPAuthenticationError(535, b"sensitive-provider-response"),
        ssl.SSLCertVerificationError("sensitive-provider-response"),
        OSError("sensitive-provider-response"),
    ],
)
def test_gmail_failure_does_not_leak_credentials_codes_or_server_response(
    gmail, monkeypatch, error
):
    def failed(*_a, **_k):
        raise error

    monkeypatch.setattr(security_mail.smtplib, "SMTP_SSL", failed)
    with pytest.raises(HTTPException) as failure:
        security_mail.send_code(OWNER, "123456", "delivery")
    assert failure.value.status_code == 503
    assert all(
        value not in failure.value.detail
        for value in ("sensitive-provider-response", "123456", "abcdefghijklmnop")
    )


def test_recipient_refusal_fails_delivery(gmail, monkeypatch):
    smtp = security_mail.smtplib.SMTP_SSL
    monkeypatch.setattr(
        smtp, "send_message", lambda *_a, **_k: {OWNER: (550, b"private-recipient-refusal")}
    )
    with pytest.raises(HTTPException) as failure:
        security_mail.send_code(OWNER, "123456", "delivery")
    assert failure.value.status_code == 503 and "private-recipient" not in failure.value.detail


def test_resend_default_keeps_its_owner_only_testing_restriction(gmail, monkeypatch):
    monkeypatch.delenv("AUTH_EMAIL_PROVIDER")
    monkeypatch.setenv("RESEND_API_KEY", "re_fake_resend_key_never_sent")
    monkeypatch.setenv("AUTH_EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("AUTH_EMAIL_TEST_RECIPIENT", OWNER)
    security_mail.ensure_ready(OWNER)
    with pytest.raises(HTTPException) as failure:
        security_mail.ensure_ready(EMAIL)
    assert failure.value.status_code == 503 and not gmail["connections"]


def test_gmail_supports_login_approved_enrollment_and_password_recovery(
    gmail, monkeypatch, tmp_path
):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        challenge = client.post("/auth/sign-in", headers=HEADERS, json=ADMIN).json()
        assert gmail["messages"][-1][0]["To"] == OWNER
        response = client.post(
            "/auth/mfa/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": code(gmail)},
        )
        assert response.status_code == 200
        assert (
            client.post("/admin/accounts", headers=HEADERS, json={"email": EMAIL}).status_code
            == 201
        )
        challenge = client.post("/auth/enroll/start", headers=HEADERS, json={"email": EMAIL}).json()
        assert gmail["messages"][-1][0]["To"] == EMAIL
        proof = client.post(
            "/auth/enroll/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": code(gmail)},
        ).json()
        assert (
            client.post(
                "/auth/enroll/complete",
                headers=HEADERS,
                json={**MEMBER, "setup_grant": proof["setup_grant"]},
            ).status_code
            == 200
        )
        challenge = client.post(
            "/auth/password-reset/start", headers=HEADERS, json={"email": EMAIL}
        ).json()
        assert gmail["messages"][-1][0]["To"] == EMAIL
        proof = client.post(
            "/auth/password-reset/verify",
            headers=HEADERS,
            json={"challenge_id": challenge["challenge_id"], "code": code(gmail)},
        ).json()
        assert (
            client.post(
                "/auth/password-reset/complete",
                headers=HEADERS,
                json={
                    "reset_grant": proof["reset_grant"],
                    "new_password": "new-gmail-recovery-password-2026",
                },
            ).status_code
            == 200
        )
        assert client.get("/auth/me").status_code == 401


def test_gmail_delivery_failure_cleans_pending_challenge_and_keeps_account_signed_out(
    gmail, monkeypatch, tmp_path
):
    monkeypatch.setenv("AUTH_REQUIRED", "1")
    monkeypatch.setenv("AUTH_USERNAME", ADMIN["username"])
    monkeypatch.setenv("AUTH_PASSWORD", ADMIN["password"])
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", OWNER)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    def fail(*_a, **_k):
        raise smtplib.SMTPAuthenticationError(535, b"private-auth-error")

    monkeypatch.setattr(security_mail.smtplib, "SMTP_SSL", fail)
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        response = client.post("/auth/sign-in", headers=HEADERS, json=ADMIN)
        assert response.status_code == 503 and "private-auth-error" not in response.text
        assert client.get("/auth/me").status_code == 401
        with client.app.state.accounts.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM email_challenges").fetchone()[0] == 0
