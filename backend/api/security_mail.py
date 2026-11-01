"""Server-only transactional delivery. Never log codes or provider responses."""

import os
import re
from urllib.parse import quote

import httpx
from email_validator import EmailNotValidError, validate_email
from fastapi import HTTPException


def normalize_email(value):
    try:
        return validate_email(
            str(value or "").strip(), check_deliverability=False, allow_smtputf8=False
        ).normalized.lower()
    except EmailNotValidError as exc:
        raise ValueError("Enter a valid registered email address.") from exc


def sender_settings():
    key = os.environ.get("RESEND_API_KEY", "").strip()
    sender = normalize_email(os.environ.get("AUTH_EMAIL_FROM", "onboarding@resend.dev"))
    test_recipient = os.environ.get("AUTH_EMAIL_TEST_RECIPIENT", "").strip()
    if test_recipient:
        test_recipient = normalize_email(test_recipient)
    if not key.startswith("re_") or len(key) < 16:
        raise ValueError(
            "Email delivery is not configured. Ask the operator to finish email setup."
        )
    if sender.endswith("@resend.dev") and not test_recipient:
        raise ValueError("The test email sender requires an explicit test recipient.")
    return key, sender, test_recipient


def delivery_provider():
    provider = os.environ.get("AUTH_EMAIL_PROVIDER", "resend").strip().lower()
    if provider not in {"resend", "brevo", "agentmail"}:
        raise ValueError("Choose agentmail, resend or brevo for AUTH_EMAIL_PROVIDER.")
    return provider


def brevo_settings():
    key = os.environ.get("BREVO_API_KEY", "").strip()
    sender = normalize_email(os.environ.get("BREVO_EMAIL_FROM", ""))
    if not key.startswith("xkeysib-") or len(key) < 16 or any(char.isspace() for char in key):
        raise ValueError("Configure a private Brevo API key and a sender verified in Brevo first.")
    return key, sender


def agentmail_settings():
    key = os.environ.get("AGENTMAIL_API_KEY", "").strip()
    inbox = os.environ.get("AGENTMAIL_INBOX_ID", "").strip()
    if (
        not key.startswith("am_")
        or len(key) < 16
        or any(char.isspace() for char in key)
        or not re.fullmatch(r"[a-zA-Z0-9_.@+\-]{1,254}", inbox)
        or inbox in {".", ".."}
    ):
        raise ValueError(
            "Configure a private AgentMail API key and dedicated sender inbox ID first."
        )
    return key, inbox


def configured():
    try:
        if delivery_provider() == "agentmail":
            agentmail_settings()
        elif delivery_provider() == "brevo":
            brevo_settings()
        else:
            sender_settings()
        return True
    except ValueError:
        return False


def ensure_ready(recipient=None):
    try:
        if delivery_provider() == "agentmail":
            agentmail_settings()
            return
        if delivery_provider() == "brevo":
            brevo_settings()
            return
        _, sender, test_recipient = sender_settings()
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None
    if recipient and sender.endswith("@resend.dev") and recipient != test_recipient:
        raise HTTPException(
            503,
            "The test email sender can only deliver to its registered owner. Configure a verified sender domain before adding other users.",
        )


def send_code(recipient, code, delivery_id):
    _send_message(
        recipient,
        "Your Invoice Checker security code",
        f"Your Invoice Checker security code is: {code}\n\n"
        "This code expires in five minutes and can be used once.\n"
        "If you did not request this code, ignore this email. Do not share the code.\n",
        delivery_id,
    )


def send_invitation(recipient, join_url, delivery_id):
    _send_message(
        recipient,
        "Your invitation to Invoice Checker",
        f"You have been approved to join Invoice Checker with {recipient}.\n\n"
        f"Create your username and password using your personal invitation link:\n{join_url}\n\n"
        "This link expires after 24 hours and can be used once. Do not forward it.\n"
        "If you were not expecting this invitation, ignore this email.\n",
        delivery_id,
    )


def _send_message(recipient, subject, body, delivery_id):
    ensure_ready(recipient)
    recipient = normalize_email(recipient)
    if delivery_provider() == "agentmail":
        return _agentmail_send(recipient, subject, body, delivery_id)
    if delivery_provider() == "brevo":
        return _brevo_send(recipient, subject, body)
    key, sender, _ = sender_settings()
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": "Bearer " + key, "Idempotency-Key": "signin-" + delivery_id},
            json={"from": sender, "to": [recipient], "subject": subject, "text": body},
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success or not isinstance(response.json().get("id"), str):
            raise ValueError("Delivery rejected")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise HTTPException(
            503, "The email could not be sent. Ask the operator to check email delivery."
        ) from None


def _brevo_send(recipient, subject, body):
    key, sender = brevo_settings()
    try:
        response = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": key, "accept": "application/json"},
            json={
                "sender": {"name": "Invoice Checker", "email": sender},
                "to": [{"email": recipient}],
                "subject": subject,
                "textContent": body,
            },
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success or not isinstance(response.json().get("messageId"), str):
            raise ValueError("Delivery rejected")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise HTTPException(
            503,
            "The email could not be sent. Check the Brevo API key, verified sender, account status and sending allowance.",
        ) from None


def _agentmail_send(recipient, subject, body, delivery_id):
    key, inbox = agentmail_settings()
    try:
        response = httpx.post(
            f"https://api.agentmail.to/v0/inboxes/{quote(inbox, safe='')}/messages/send",
            headers={"Authorization": "Bearer " + key, "Idempotency-Key": "ic-" + delivery_id},
            json={"to": [recipient], "subject": subject, "text": body},
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success or not isinstance(response.json().get("message_id"), str):
            raise ValueError("Delivery rejected")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise HTTPException(
            503,
            "The email could not be sent. Check the AgentMail key, sender inbox, account verification and sending allowance.",
        ) from None
