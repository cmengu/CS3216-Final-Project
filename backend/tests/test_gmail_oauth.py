"""Only gmail.send is requested/granted; Google connections and MIME delivery are isolated."""

import base64
import hashlib
import json
import threading
from email import message_from_bytes, policy
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from fastapi import HTTPException

from api import connect_gmail, gmail_oauth, security_mail

_REAL_INVITATION = security_mail.send_invitation


@pytest.fixture
def oauth(monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "gmail_oauth")
    monkeypatch.setenv("GMAIL_OAUTH_FROM", "sender@gmail.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "fake.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "private-client-secret")
    monkeypatch.setenv("GMAIL_OAUTH_REFRESH_TOKEN", "private-refresh-token")
    monkeypatch.setattr(gmail_oauth, "_cached", None)
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        if url == gmail_oauth.TOKEN_URL:
            return httpx.Response(
                200,
                json={
                    "access_token": "private-access-token",
                    "scope": gmail_oauth.SCOPE,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                },
            )
        assert url == gmail_oauth.SEND_URL, (
            "Unexpected Google endpoint (mailbox reads are forbidden)"
        )
        return httpx.Response(200, json={"id": "fixture-delivery"})

    monkeypatch.setattr(httpx, "post", post)
    return calls


def test_google_send_only_can_deliver_codes_and_personal_invitation_links(oauth):
    assert security_mail.configured()
    security_mail.send_code("member@example.com", "123456", "code-delivery")
    _REAL_INVITATION(
        "other@example.com",
        "https://app.example.com/join#invite=private-invitation",
        "invite-delivery",
    )
    assert [call[0] for call in oauth] == [
        gmail_oauth.TOKEN_URL,
        gmail_oauth.SEND_URL,
        gmail_oauth.SEND_URL,
    ]
    for _, kwargs in oauth:
        assert kwargs["follow_redirects"] is False and kwargs["timeout"] == 10
    for call, recipient in zip(oauth[1:], ["member@example.com", "other@example.com"]):
        kwargs = call[1]
        assert kwargs["headers"] == {"Authorization": "Bearer private-access-token"}
        message = message_from_bytes(
            base64.urlsafe_b64decode(kwargs["json"]["raw"]), policy=policy.default
        )
        assert message["To"] == recipient and message["From"] == "sender@gmail.com"
        assert "private-access-token" not in str(message)
    message = message_from_bytes(
        base64.urlsafe_b64decode(oauth[-1][1]["json"]["raw"]), policy=policy.default
    )
    assert "https://app.example.com/join#invite=private-invitation" in message.get_content()


@pytest.mark.parametrize(
    "scope",
    [
        "",
        gmail_oauth.SCOPE + " https://www.googleapis.com/auth/gmail.readonly",
        "https://mail.google.com/",
    ],
)
def test_missing_or_broad_google_permissions_fail_closed_without_email(oauth, monkeypatch, scope):
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        return httpx.Response(
            200, json={"access_token": "private-access", "scope": scope, "token_type": "Bearer"}
        )

    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(HTTPException) as result:
        security_mail.send_code("member@example.com", "123456", "delivery")
    assert result.value.status_code == 503 and calls == [gmail_oauth.TOKEN_URL]
    assert "private-access" not in result.value.detail


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500])
def test_google_errors_do_not_leak_tokens_messages_or_server_details(oauth, monkeypatch, status):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_a, **_k: httpx.Response(status, json={"private": "sensitive-provider-response"}),
    )
    with pytest.raises(HTTPException) as result:
        _REAL_INVITATION(
            "member@example.com", "https://example.com/join#invite=private-invite", "delivery"
        )
    assert result.value.status_code == 503
    assert all(
        secret not in result.value.detail
        for secret in ("sensitive-provider-response", "private-invite", "private-refresh-token")
    )


def test_refresh_cache_expires_and_rotated_credentials_cannot_reuse_old_token(oauth, monkeypatch):
    clock = [1000]
    monkeypatch.setattr(gmail_oauth.time, "monotonic", lambda: clock[0])
    security_mail.send_code("member@example.com", "123456", "one")
    security_mail.send_code("member@example.com", "123456", "two")
    assert sum(url == gmail_oauth.TOKEN_URL for url, _ in oauth) == 1
    clock[0] += 3600
    security_mail.send_code("member@example.com", "123456", "three")
    assert sum(url == gmail_oauth.TOKEN_URL for url, _ in oauth) == 2
    monkeypatch.setenv("GMAIL_OAUTH_REFRESH_TOKEN", "rotated-private-refresh-token")
    security_mail.send_code("member@example.com", "123456", "four")
    assert sum(url == gmail_oauth.TOKEN_URL for url, _ in oauth) == 3


def test_authorization_url_requests_only_sending_with_pkce_state_and_offline_access():
    url = connect_gmail.authorization_url(
        "fake.apps.googleusercontent.com",
        "http://127.0.0.1:4321/oauth2/callback",
        "opaque-state",
        "private-verifier",
        "sender@gmail.com",
    )
    parsed = urlsplit(url)
    params = parse_qs(parsed.query)
    assert parsed.scheme == "https" and parsed.netloc == "accounts.google.com"
    assert params["scope"] == [gmail_oauth.SCOPE]
    assert params["state"] == ["opaque-state"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["access_type"] == ["offline"] and params["include_granted_scopes"] == ["false"]
    assert params["code_challenge"] == [
        base64.urlsafe_b64encode(hashlib.sha256(b"private-verifier").digest()).rstrip(b"=").decode()
    ]


def test_local_consent_checks_state_saves_privately_and_never_sends_email(
    tmp_path, monkeypatch, capsys
):
    client = tmp_path / ".env.google-client.json"
    client.write_text(
        json.dumps(
            {
                "installed": {
                    "client_id": "fixture.apps.googleusercontent.com",
                    "client_secret": "private-client-secret",
                    "token_uri": "https://attacker.invalid",
                }
            }
        )
    )
    settings = tmp_path / ".env"
    settings.write_text("AUTH_SECRET=existing-signing-secret\nAUTH_EMAIL_PROVIDER=resend\n")
    monkeypatch.setattr(connect_gmail, "BACKEND", tmp_path)
    threads = []
    responses = []
    params = {}

    def browser(url):
        params.update(parse_qs(urlsplit(url).query))

        def callback():
            base = params["redirect_uri"][0]
            responses.append(
                httpx.get(
                    base + "?" + urlencode({"state": "forged", "code": "wrong-code"}), timeout=5
                ).status_code
            )
            responses.append(
                httpx.get(
                    base
                    + "?"
                    + urlencode({"state": params["state"][0], "code": "private-auth-code"}),
                    timeout=5,
                ).status_code
            )

        thread = threading.Thread(target=callback)
        threads.append(thread)
        thread.start()

    monkeypatch.setattr(connect_gmail.webbrowser, "open", browser)

    def post(url, **kwargs):
        assert url == gmail_oauth.TOKEN_URL
        assert kwargs["follow_redirects"] is False
        data = kwargs["data"]
        assert data["code"] == "private-auth-code"
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(data["code_verifier"].encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert params["code_challenge"] == [expected]
        return httpx.Response(
            200,
            json={
                "access_token": "private-access",
                "refresh_token": "private-refresh-token",
                "token_type": "Bearer",
                "scope": gmail_oauth.SCOPE,
            },
        )

    monkeypatch.setattr(httpx, "post", post)
    connect_gmail.connect(client, "sender@gmail.com", settings)
    for thread in threads:
        thread.join(timeout=5)
    assert responses == [400, 200]
    saved = settings.read_text()
    assert (
        "AUTH_SECRET=existing-signing-secret" in saved
        and "AUTH_EMAIL_PROVIDER=gmail_oauth" in saved
    )
    assert "GMAIL_OAUTH_REFRESH_TOKEN=private-refresh-token" in saved
    output = capsys.readouterr().out
    assert all(
        secret not in output
        for secret in (
            "private-auth-code",
            "private-client-secret",
            "private-refresh-token",
            "private-access",
        )
    )
    assert not (tmp_path / "runtime/gmail-send-only.url").exists()


def test_invalid_or_broad_token_exchange_does_not_overwrite_settings(tmp_path, monkeypatch):
    settings = tmp_path / ".env"
    settings.write_text("unchanged\n")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_a, **_k: httpx.Response(
            200,
            json={
                "access_token": "private-access",
                "refresh_token": "private-refresh",
                "token_type": "Bearer",
                "scope": "https://mail.google.com/",
            },
        ),
    )
    with pytest.raises(ValueError, match="send-only"):
        connect_gmail.exchange(
            "fake.apps.googleusercontent.com",
            "private-secret",
            "http://127.0.0.1:1/oauth2/callback",
            "private-verifier",
            "private-code",
        )
    assert settings.read_text() == "unchanged\n"


def test_client_file_must_be_desktop_and_cannot_change_google_endpoints(tmp_path):
    path = tmp_path / "client.json"
    path.write_text(
        json.dumps(
            {"web": {"client_id": "fake.apps.googleusercontent.com", "client_secret": "secret"}}
        )
    )
    with pytest.raises(ValueError, match="Desktop"):
        connect_gmail.read_client(path)
