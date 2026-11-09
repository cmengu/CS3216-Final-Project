"""The landing page contact form emails the team and cannot be used to send bulk mail."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import contact, security_mail
from api.app import create_app

HEADERS = {"X-Requested-With": "InvoiceChecker"}
MESSAGE = {
    "name": "Mai Tran",
    "email": "Mai@Example.com",
    "company": "Harbour Hotel",
    "message": "We check about 300 supplier invoices a month. Can we try it?",
}


@pytest.fixture
def sent(monkeypatch):
    messages = []
    monkeypatch.setenv("AUTH_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.delenv("CONTACT_EMAIL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        security_mail,
        "_send_message",
        lambda recipient, subject, body, delivery: messages.append((recipient, subject, body)),
    )
    return messages


@pytest.fixture
def client(sent, tmp_path):
    with TestClient(create_app(storage_dir=tmp_path, start_worker=False)) as client:
        yield client


def test_message_is_emailed_to_the_administrator(client, sent):
    response = client.post("/contact", headers=HEADERS, json=MESSAGE)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "sent"}
    [(recipient, subject, body)] = sent
    assert recipient == "owner@example.com"
    assert subject == "Linecheck enquiry from Mai Tran (Harbour Hotel)"
    assert "Email: mai@example.com" in body
    assert MESSAGE["message"] in body


def test_contact_email_overrides_the_administrator(client, sent, monkeypatch):
    monkeypatch.setenv("CONTACT_EMAIL", "gtm@example.com")
    assert client.post("/contact", headers=HEADERS, json=MESSAGE).status_code == 200
    assert sent[0][0] == "gtm@example.com"


def test_protection_header_is_required(client, sent):
    response = client.post("/contact", json=MESSAGE)
    assert response.status_code == 403
    assert sent == []


def test_untrusted_origin_is_refused(client, sent):
    response = client.post(
        "/contact", headers={**HEADERS, "Origin": "https://attacker.example"}, json=MESSAGE
    )
    assert response.status_code == 403
    assert sent == []


@pytest.mark.parametrize(
    "change",
    [
        {"email": "not-an-email"},
        {"name": ""},
        {"message": "short"},
        {"message": "x" * 2001},
        {"extra": "field"},
    ],
)
def test_invalid_messages_are_refused(client, sent, change):
    response = client.post("/contact", headers=HEADERS, json={**MESSAGE, **change})
    assert response.status_code == 422
    assert sent == []


def test_line_breaks_cannot_reach_the_subject(client, sent):
    body = {**MESSAGE, "name": "Mai\r\nBcc: victim@example.com", "company": "A\nB"}
    assert client.post("/contact", headers=HEADERS, json=body).status_code == 200
    subject = sent[0][1]
    assert "\n" not in subject and "\r" not in subject
    assert subject == "Linecheck enquiry from Mai Bcc: victim@example.com (A B)"


def test_filled_spam_trap_is_accepted_but_not_sent(client, sent):
    response = client.post("/contact", headers=HEADERS, json={**MESSAGE, "website": "http://spam"})
    assert response.status_code == 200
    assert sent == []


def test_each_visitor_is_rate_limited(client, sent):
    for _ in range(contact.PER_IP_HOUR):
        assert client.post("/contact", headers=HEADERS, json=MESSAGE).status_code == 200
    response = client.post("/contact", headers=HEADERS, json=MESSAGE)
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert len(sent) == contact.PER_IP_HOUR


def test_missing_recipient_says_the_form_is_not_set_up(client, sent, monkeypatch):
    monkeypatch.delenv("AUTH_ADMIN_EMAIL", raising=False)
    response = client.post("/contact", headers=HEADERS, json=MESSAGE)
    assert response.status_code == 503
    assert (
        response.json()["detail"] == "The contact form is not set up yet. Please try again later."
    )
    assert sent == []


def test_delivery_failure_is_reported(client, monkeypatch):
    def fail(*_args):
        raise HTTPException(503, "The email could not be sent.")

    monkeypatch.setattr(security_mail, "_send_message", fail)
    response = client.post("/contact", headers=HEADERS, json=MESSAGE)
    assert response.status_code == 503
