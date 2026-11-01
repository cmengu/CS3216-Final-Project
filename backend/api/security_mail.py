"""Server-only Resend or Gmail delivery. Never log codes or provider responses."""

import os
import smtplib
import ssl
from email.message import EmailMessage

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
    if provider not in {"resend", "gmail"}:
        raise ValueError("Choose resend or gmail for AUTH_EMAIL_PROVIDER.")
    return provider


def gmail_settings():
    sender = normalize_email(os.environ.get("GMAIL_SMTP_USER", ""))
    password = "".join(os.environ.get("GMAIL_APP_PASSWORD", "").split())
    if not sender.endswith("@gmail.com") or len(password) != 16:
        raise ValueError(
            "Gmail delivery needs GMAIL_SMTP_USER and a 16-character Google app password. Keep the app password in private backend configuration."
        )
    return sender, password


def configured():
    try:
        if delivery_provider() == "gmail":
            gmail_settings()
        else:
            sender_settings()
        return True
    except ValueError:
        return False


def ensure_ready(recipient=None):
    try:
        if delivery_provider() == "gmail":
            gmail_settings()
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
    ensure_ready(recipient)
    recipient = normalize_email(recipient)
    if delivery_provider() == "gmail":
        return _gmail_send(recipient, code)
    key, sender, _ = sender_settings()
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": "Bearer " + key, "Idempotency-Key": "signin-" + delivery_id},
            json={
                "from": sender,
                "to": [recipient],
                "subject": "Your Invoice Checker security code",
                "text": f"Your Invoice Checker security code is: {code}\n\nThis code expires in five minutes and can be used once.\nIf you did not request this code, ignore this email. Do not share the code.\n",
            },
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success or not isinstance(response.json().get("id"), str):
            raise ValueError("Delivery rejected")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise HTTPException(
            503,
            "The security email could not be sent. Sign in again later, or ask the operator to check email delivery.",
        ) from None


def _gmail_send(recipient, code):
    sender, password = gmail_settings()
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "Your Invoice Checker security code"
    message.set_content(
        f"Your Invoice Checker security code is: {code}\n\n"
        "This code expires in five minutes and can be used once.\n"
        "If you did not request this code, ignore this email. Do not share the code.\n"
    )
    try:
        # Fixed Gmail destination, mandatory validated TLS, no debug output or fallback.
        with smtplib.SMTP_SSL(
            "smtp.gmail.com", 465, timeout=10, context=ssl.create_default_context()
        ) as smtp:
            smtp.login(sender, password)
            if smtp.send_message(message, from_addr=sender, to_addrs=[recipient]):
                raise ValueError("Recipient refused")
    except (smtplib.SMTPException, OSError, ValueError):
        raise HTTPException(
            503,
            "The security email could not be sent. Ask the operator to check the Gmail app password and sending limits.",
        ) from None
