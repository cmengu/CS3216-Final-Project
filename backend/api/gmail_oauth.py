"""Gmail API delivery with exactly gmail.send authority; never read a mailbox."""

import base64
import hashlib
import os
import threading
import time
from email.message import EmailMessage

import httpx
from fastapi import HTTPException

SCOPE = "https://www.googleapis.com/auth/gmail.send"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
_lock = threading.Lock()
_cached = None


def settings():
    from .security_mail import normalize_email

    sender = normalize_email(os.environ.get("GMAIL_OAUTH_FROM", ""))
    values = [
        os.environ.get(key, "").strip()
        for key in (
            "GMAIL_OAUTH_CLIENT_ID",
            "GMAIL_OAUTH_CLIENT_SECRET",
            "GMAIL_OAUTH_REFRESH_TOKEN",
        )
    ]
    if not values[0].endswith(".apps.googleusercontent.com") or not all(values):
        raise ValueError(
            "Connect the Gmail sender with the send-only Google authorization tool first."
        )
    return sender, *values


def validate_token(body):
    if not isinstance(body, dict) or set(str(body.get("scope", "")).split()) != {SCOPE}:
        raise ValueError("Google must grant exactly the Gmail send-only permission.")
    if not isinstance(body.get("access_token"), str) or not body["access_token"]:
        raise ValueError("Missing access token")
    if str(body.get("token_type", "")).lower() != "bearer":
        raise ValueError("Unexpected token type")
    return body["access_token"]


def access_token(client_id, client_secret, refresh):
    global _cached
    identity = hashlib.sha256((client_id + "\0" + client_secret + "\0" + refresh).encode()).digest()
    with _lock:
        if _cached and _cached[0] == identity and _cached[2] > time.monotonic():
            return _cached[1]
        response = httpx.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success:
            raise ValueError("Google authorization needs reconnecting")
        body = response.json()
        token = validate_token(body)
        lifetime = min(3600, max(0, int(body.get("expires_in", 0)) - 60))
        _cached = (identity, token, time.monotonic() + lifetime)
        return token


def send(recipient, subject, body):
    sender, client_id, client_secret, refresh = settings()
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = sender, recipient, subject
    message.set_content(body)
    try:
        token = access_token(client_id, client_secret, refresh)
        response = httpx.post(
            SEND_URL,
            headers={"Authorization": "Bearer " + token},
            json={"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()},
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success or not isinstance(response.json().get("id"), str):
            raise ValueError("Google delivery rejected")
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise HTTPException(
            503,
            "The email could not be sent. Ask the operator to check the Google send-only connection and sending limits.",
        ) from None
