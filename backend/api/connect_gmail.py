"""Operator-only local Google consent, requesting exactly Gmail send permission."""

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from .gmail_oauth import SCOPE, TOKEN_URL, validate_token
from .security_mail import normalize_email

BACKEND = Path(__file__).resolve().parents[1]


def authorization_url(client_id, redirect, state, verifier, sender):
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": SCOPE,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent select_account",
            "include_granted_scopes": "false",
            "login_hint": sender,
        }
    )


def read_client(path):
    try:
        client = json.loads(path.read_text(encoding="utf-8"))["installed"]
        client_id, secret = client["client_id"], client["client_secret"]
        if (
            not isinstance(client_id, str)
            or not client_id.endswith(".apps.googleusercontent.com")
            or not isinstance(secret, str)
            or not secret
        ):
            raise ValueError()
        return client_id, secret
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError(
            "Save a Google OAuth Desktop app client JSON file at the supplied path."
        ) from None


def exchange(client_id, secret, redirect, verifier, code):
    try:
        response = httpx.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": secret,
                "redirect_uri": redirect,
                "code_verifier": verifier,
                "code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
            follow_redirects=False,
        )
        if not response.is_success:
            raise ValueError()
        body = response.json()
        validate_token(body)
        if not isinstance(body.get("refresh_token"), str) or not body["refresh_token"]:
            raise ValueError()
        return body["refresh_token"]
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise ValueError(
            "Google did not provide a send-only offline connection. Retry consent with only Gmail sending permission."
        ) from None


def save_connection(path, sender, client_id, secret, refresh):
    values = {
        "AUTH_EMAIL_PROVIDER": "gmail_oauth",
        "GMAIL_OAUTH_FROM": sender,
        "GMAIL_OAUTH_CLIENT_ID": client_id,
        "GMAIL_OAUTH_CLIENT_SECRET": secret,
        "GMAIL_OAUTH_REFRESH_TOKEN": refresh,
    }
    # Preserve unrelated private settings; .env takes precedence over .env.email.
    existing = path.read_text().splitlines() if path.exists() else []
    kept = [line for line in existing if line.partition("=")[0].strip() not in values]
    for value in values.values():
        if any(char in value for char in "\r\n\"'"):
            raise ValueError("Unexpected credential format")
    fd, temporary_name = tempfile.mkstemp(prefix=".env.gmail-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(
                "\n".join(kept + [f"{key}={value}" for key, value in values.items()]) + "\n"
            )
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def connect(client_file, sender, output, open_browser=True):
    client_id, secret = read_client(client_file)
    sender = normalize_email(sender)
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    result = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log a callback URL or authorization code.

        def do_GET(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            if (
                parsed.path != "/oauth2/callback"
                or len(self.path) > 8192
                or not hmac.compare_digest(query.get("state", [""])[0], state)
            ):
                self.send_error(400, "Invalid authorization callback")
                return
            result["code"] = query.get("code", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(
                b"Google authorization received. Return to Invoice Checker setup for the result."
            )

    with HTTPServer(("127.0.0.1", 0), Callback) as server:
        redirect = f"http://127.0.0.1:{server.server_port}/oauth2/callback"
        url = authorization_url(client_id, redirect, state, verifier, sender)
        shortcut = BACKEND / "runtime" / "gmail-send-only.url"
        shortcut.parent.mkdir(parents=True, exist_ok=True)
        shortcut.write_text(f"[InternetShortcut]\nURL={url}\n")
        os.chmod(shortcut, 0o600)
        print("Approve only 'Send email on your behalf' in Google's consent page.")
        print(f"Private authorization shortcut: {shortcut}")
        try:
            if open_browser:
                webbrowser.open(url)
            server.timeout = 1
            deadline = time.monotonic() + 300
            while "code" not in result and time.monotonic() < deadline:
                server.handle_request()
        finally:
            shortcut.unlink(missing_ok=True)
    if not result.get("code"):
        raise ValueError("Google authorization was cancelled or timed out. No settings changed.")
    refresh = exchange(client_id, secret, redirect, verifier, result["code"])
    save_connection(output, sender, client_id, secret, refresh)
    print(
        "Google send-only connection saved privately. Restart the backend to activate it. No email sent."
    )


def main():
    parser = argparse.ArgumentParser(description="Connect Google with Gmail send-only permission.")
    parser.add_argument("--client-file", type=Path, default=BACKEND / ".env.gmail-oauth.json")
    parser.add_argument("--sender", required=True)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        # Saving in .env takes precedence over old .env.email provider configuration.
        connect(args.client_file, args.sender, BACKEND / ".env", not args.no_browser)
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
