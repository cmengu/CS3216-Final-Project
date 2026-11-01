"""Delivery vendors send invitations/codes; recipient mailboxes are never connected."""

import httpx
import pytest
from fastapi import HTTPException

from api import security_mail

_REAL_INVITATION = security_mail.send_invitation


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_fake_provider_key_never_sent")
    monkeypatch.setenv("AUTH_EMAIL_FROM", "security@example.com")
    monkeypatch.setenv("BREVO_EMAIL_FROM", "verified-sender@gmail.com")
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-fake-private-api-key")
    monkeypatch.delenv("AUTH_EMAIL_TEST_RECIPIENT", raising=False)
    requests = []

    def post(url, **kwargs):
        requests.append((url, kwargs))
        return httpx.Response(201, json={"id": "resend-fixture", "messageId": "brevo-fixture"})

    monkeypatch.setattr(httpx, "post", post)
    return requests


@pytest.mark.parametrize("provider", ["resend", "brevo"])
@pytest.mark.parametrize("recipient", ["recipient@gmail.com", "recipient@outlook.com"])
def test_both_vendors_send_the_personal_invitation_to_the_exact_recipient(
    mail, monkeypatch, provider, recipient
):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", provider)
    assert security_mail.configured()
    link = "https://app.example.com/join#invite=private-recipient-link"
    _REAL_INVITATION(recipient, link, "opaque-delivery-id")
    url, kwargs = mail[0]
    assert url == (
        "https://api.resend.com/emails"
        if provider == "resend"
        else "https://api.brevo.com/v3/smtp/email"
    )
    assert kwargs["timeout"] == 10 and kwargs["follow_redirects"] is False
    body = kwargs["json"]
    if provider == "resend":
        assert body["to"] == [recipient] and body["from"] == "security@example.com"
        assert kwargs["headers"]["Authorization"] == "Bearer re_fake_provider_key_never_sent"
        assert link in body["text"]
    else:
        assert body["to"] == [{"email": recipient}]
        assert body["sender"] == {"email": "verified-sender@gmail.com", "name": "Invoice Checker"}
        assert kwargs["headers"]["api-key"] == "xkeysib-fake-private-api-key"
        assert "Authorization" not in kwargs["headers"]
        assert link in body["textContent"]
    assert "xkeysib-fake-private-api-key" not in str(body)


def test_brevo_delivers_security_codes_with_the_same_registered_recipient(mail, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "brevo")
    security_mail.send_code("recipient@gmail.com", "123456", "opaque-code-id")
    assert mail[0][1]["json"]["to"] == [{"email": "recipient@gmail.com"}]
    assert "123456" in mail[0][1]["json"]["textContent"]


def test_resend_test_sender_stays_owner_only_and_never_rewrites_a_recipient(mail, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("AUTH_EMAIL_TEST_RECIPIENT", "owner@outlook.com")
    security_mail.ensure_ready("owner@outlook.com")
    with pytest.raises(HTTPException) as result:
        _REAL_INVITATION(
            "recipient@gmail.com", "https://example.com/join#invite=private", "delivery"
        )
    assert result.value.status_code == 503 and not mail


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 302])
def test_brevo_rejections_never_leak_keys_links_or_vendor_details(mail, monkeypatch, status):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "brevo")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_a, **_k: httpx.Response(status, json={"private": "sensitive-vendor-response"}),
    )
    with pytest.raises(HTTPException) as result:
        _REAL_INVITATION(
            "recipient@gmail.com", "https://example.com/join#invite=private-link", "delivery"
        )
    assert result.value.status_code == 503
    assert all(
        value not in result.value.detail
        for value in ("private-link", "xkeysib-fake-private-api-key", "sensitive-vendor-response")
    )


def test_brevo_network_failure_never_falls_back_to_another_vendor(mail, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "brevo")
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        raise httpx.ConnectError("sensitive-network-error")

    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(HTTPException) as result:
        security_mail.send_code("recipient@outlook.com", "123456", "delivery")
    assert calls == ["https://api.brevo.com/v3/smtp/email"]
    assert "sensitive-network-error" not in result.value.detail


def test_unconfigured_brevo_does_not_try_resend_or_a_mailbox(mail, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "brevo")
    monkeypatch.delenv("BREVO_API_KEY")
    assert not security_mail.configured()
    with pytest.raises(HTTPException) as result:
        security_mail.send_code("recipient@gmail.com", "123456", "delivery")
    assert result.value.status_code == 503 and not mail


def test_removed_google_provider_cannot_connect_a_mailbox(mail, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "gmail_oauth")
    assert not security_mail.configured()
    with pytest.raises(HTTPException) as result:
        security_mail.send_code("recipient@gmail.com", "123456", "delivery")
    assert result.value.status_code == 503 and not mail
