"""Microsoft Outlook / Graph OAuth 2.0 (Authorization Code + PKCE) and inbox reader.

Supports both Microsoft organizational accounts and personal Microsoft accounts (@outlook.com,
@live.com, @hotmail.com) via the /common authority. Tokens are encrypted at rest in SQLite
using a key derived from MICROSOFT_CLIENT_SECRET and automatically refreshed when expired.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, ConfigDict

from .storage import Store

router = APIRouter(tags=["outlook"])

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
OAUTH_SCOPES = "openid profile email offline_access User.Read Mail.Read"
STATE_TTL_SECONDS = 900  # 15 minutes

SCHEMA = """
CREATE TABLE IF NOT EXISTS outlook_oauth_states (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS outlook_connections (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    encrypted_tokens TEXT NOT NULL,
    connected_at TEXT NOT NULL
);
"""


class OutlookConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str
    client_secret: str
    redirect_uri: str
    tenant_id: str
    frontend_url: str

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    @property
    def authorize_url(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/authorize"

    @property
    def token_url(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"


class OutlookStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    configured: bool
    connected: bool
    email: str | None = None
    displayName: str | None = None
    connectedAt: str | None = None
    redirectUri: str


class OutlookAttachmentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    contentType: str
    size: int
    isPdf: bool


class OutlookMessageSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    subject: str
    senderName: str
    senderEmail: str
    receivedAt: str
    bodyPreview: str
    bodyText: str
    hasAttachments: bool
    webLink: str | None = None


class OutlookMessageDetail(OutlookMessageSummary):
    model_config = ConfigDict(extra="forbid")
    attachments: list[OutlookAttachmentSummary]


class OutlookMessagesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[OutlookMessageSummary]


def get_outlook_config() -> OutlookConfig:
    return OutlookConfig(
        client_id=os.environ.get("MICROSOFT_CLIENT_ID", "").strip(),
        client_secret=os.environ.get("MICROSOFT_CLIENT_SECRET", "").strip(),
        redirect_uri=os.environ.get(
            "MICROSOFT_REDIRECT_URI", "http://localhost:8001/auth/outlook/callback"
        ).strip(),
        tenant_id=os.environ.get("MICROSOFT_TENANT_ID", "common").strip() or "common",
        frontend_url=os.environ.get("FRONTEND_URL", "http://localhost:3000").strip().rstrip("/"),
    )


def initialize(store: Store) -> None:
    with store.connect() as conn:
        conn.executescript(SCHEMA)


def _keystream(enc_key: bytes, salt: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(enc_key, salt + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_tokens(payload: dict[str, Any], secret: str) -> str:
    if not secret:
        raise ValueError("Encryption secret must not be empty")
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    salt = os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, 100_000, dklen=64)
    enc_key, mac_key = derived[:32], derived[32:]
    stream = _keystream(enc_key, salt, len(raw))
    ciphertext = bytes(a ^ b for a, b in zip(raw, stream, strict=True))
    tag = hmac.new(mac_key, salt + ciphertext, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(salt + tag + ciphertext).decode("ascii")


def decrypt_tokens(token_blob: str, secret: str) -> dict[str, Any]:
    if not secret:
        raise ValueError("Encryption secret must not be empty")
    try:
        packed = base64.urlsafe_b64decode(token_blob.encode("ascii"))
    except Exception as exc:
        raise ValueError("Malformed encrypted token blob") from exc
    if len(packed) < 48:
        raise ValueError("Truncated encrypted token blob")
    salt = packed[:16]
    tag = packed[16:48]
    ciphertext = packed[48:]
    derived = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, 100_000, dklen=64)
    enc_key, mac_key = derived[:32], derived[32:]
    expected_tag = hmac.new(mac_key, salt + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected_tag):
        raise ValueError("Encrypted token integrity check failed")
    stream = _keystream(enc_key, salt, len(ciphertext))
    raw = bytes(a ^ b for a, b in zip(ciphertext, stream, strict=True))
    return json.loads(raw.decode("utf-8"))


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _sanitize_return_to(return_to: str | None) -> str:
    if not return_to or not return_to.startswith("/") or return_to.startswith("//"):
        return "/invoices"
    return return_to


def _frontend_redirect(
    cfg: OutlookConfig, return_to: str, params: dict[str, str]
) -> RedirectResponse:
    path = _sanitize_return_to(return_to)
    sep = "&" if "?" in path else "?"
    target = f"{cfg.frontend_url}{path}{sep}{urlencode(params)}"
    return RedirectResponse(url=target, status_code=302)


def _decode_id_token_claims(id_token: str | None) -> dict[str, Any]:
    if not id_token or "." not in id_token:
        return {}
    parts = id_token.split(".")
    if len(parts) < 2:
        return {}
    payload_b64 = parts[1]
    padding = "=" * (-len(payload_b64) % 4)
    try:
        raw = base64.urlsafe_b64decode((payload_b64 + padding).encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _strip_html(text: str) -> str:
    cleaned = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"<script[^>]*>.*?</script>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"<br\s*/?>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</p\s*>", "\n\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    return cleaned.strip()


def _parse_message_summary(item: dict[str, Any]) -> OutlookMessageSummary:
    sender_obj = (item.get("from") or {}).get("emailAddress") or {}
    sender_name = (sender_obj.get("name") or "").strip()
    sender_email = (sender_obj.get("address") or "").strip()
    body_obj = item.get("body") or {}
    body_content = (body_obj.get("content") or "").strip()
    body_type = (body_obj.get("contentType") or "text").lower()
    if body_type == "html" and body_content:
        body_text = _strip_html(body_content)
    else:
        body_text = body_content
    preview = (item.get("bodyPreview") or "").strip()
    if not body_text:
        body_text = preview

    return OutlookMessageSummary(
        id=str(item.get("id") or ""),
        subject=(item.get("subject") or "").strip() or "(No subject)",
        senderName=sender_name or sender_email or "Unknown sender",
        senderEmail=sender_email,
        receivedAt=str(item.get("receivedDateTime") or ""),
        bodyPreview=preview,
        bodyText=body_text,
        hasAttachments=bool(item.get("hasAttachments")),
        webLink=item.get("webLink"),
    )


def _exchange_code_for_tokens(cfg: OutlookConfig, code: str, code_verifier: str) -> dict[str, Any]:
    data = {
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "code_verifier": code_verifier,
        "scope": OAUTH_SCOPES,
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(cfg.token_url, data=data)
    if resp.status_code >= 400:
        detail = _extract_oauth_error(resp)
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {detail}")
    return resp.json()


def _refresh_access_token(cfg: OutlookConfig, refresh_token: str) -> dict[str, Any]:
    data = {
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": OAUTH_SCOPES,
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(cfg.token_url, data=data)
    if resp.status_code >= 400:
        detail = _extract_oauth_error(resp)
        raise HTTPException(
            status_code=401,
            detail=f"Outlook session expired or revoked ({detail}). Please reconnect Outlook.",
        )
    return resp.json()


def _extract_oauth_error(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
        return str(payload.get("error_description") or payload.get("error") or resp.text)
    except Exception:
        return resp.text or f"HTTP {resp.status_code}"


def _fetch_graph_profile(access_token: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {access_token}"}
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(
            f"{GRAPH_BASE_URL}/me",
            params={"$select": "displayName,mail,userPrincipalName"},
            headers=headers,
        )
    if resp.status_code >= 400:
        return {}
    return resp.json()


def _get_valid_access_token(store: Store, cfg: OutlookConfig) -> str:
    if not cfg.configured:
        raise HTTPException(
            status_code=503,
            detail="Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.",
        )
    with store.connect() as conn:
        row = conn.execute(
            "SELECT email, display_name, encrypted_tokens FROM outlook_connections WHERE id = 1"
        ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=401,
            detail="Outlook is not connected. Connect your Microsoft account first.",
        )

    try:
        tokens = decrypt_tokens(row["encrypted_tokens"], cfg.client_secret)
    except ValueError as exc:
        with store.connect() as conn:
            conn.execute("DELETE FROM outlook_connections WHERE id = 1")
        raise HTTPException(
            status_code=401,
            detail="Stored Outlook credentials could not be decrypted. Please reconnect Outlook.",
        ) from exc

    expires_at = float(tokens.get("expires_at") or 0)
    access_token = str(tokens.get("access_token") or "")
    refresh_token = str(tokens.get("refresh_token") or "")

    if access_token and expires_at > time.time() + 60:
        return access_token

    if not refresh_token:
        with store.connect() as conn:
            conn.execute("DELETE FROM outlook_connections WHERE id = 1")
        raise HTTPException(
            status_code=401,
            detail="Outlook access token expired and no refresh token is available. Please reconnect.",
        )

    try:
        refreshed = _refresh_access_token(cfg, refresh_token)
    except HTTPException:
        with store.connect() as conn:
            conn.execute("DELETE FROM outlook_connections WHERE id = 1")
        raise

    new_access = str(refreshed.get("access_token") or "")
    new_refresh = str(refreshed.get("refresh_token") or refresh_token)
    expires_in = int(refreshed.get("expires_in") or 3600)
    updated_payload = {
        "access_token": new_access,
        "refresh_token": new_refresh,
        "expires_at": time.time() + expires_in,
    }
    encrypted = encrypt_tokens(updated_payload, cfg.client_secret)
    with store.connect() as conn:
        conn.execute(
            "UPDATE outlook_connections SET encrypted_tokens = ? WHERE id = 1",
            (encrypted,),
        )
    return new_access


def _graph_get(
    store: Store,
    cfg: OutlookConfig,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    prefer_text: bool = False,
) -> dict[str, Any]:
    access_token = _get_valid_access_token(store, cfg)
    headers = {"Authorization": f"Bearer {access_token}"}
    if prefer_text:
        headers["Prefer"] = 'outlook.body-content-type="text"'

    url = f"{GRAPH_BASE_URL}{path}"
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(url, params=params, headers=headers)

    if resp.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="Microsoft Graph rejected the access token. Please reconnect Outlook.",
        )
    if resp.status_code == 404:
        raise HTTPException(
            status_code=404, detail="Requested Outlook message or attachment was not found."
        )
    if resp.status_code >= 400:
        try:
            err_msg = resp.json().get("error", {}).get("message") or resp.text
        except Exception:
            err_msg = resp.text
        raise HTTPException(
            status_code=502,
            detail=f"Microsoft Graph request failed: {err_msg}",
        )
    return resp.json()


@router.get("/auth/outlook/login")
def outlook_login(request: Request, return_to: str = "/invoices"):
    cfg = get_outlook_config()
    if not cfg.configured:
        raise HTTPException(
            status_code=503,
            detail="Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in backend/.env.",
        )

    store: Store = request.app.state.store
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    safe_return = _sanitize_return_to(return_to)
    now = time.time()

    with store.connect() as conn:
        conn.execute(
            "DELETE FROM outlook_oauth_states WHERE created_at < ?",
            (now - STATE_TTL_SECONDS,),
        )
        conn.execute(
            """
            INSERT INTO outlook_oauth_states (state, code_verifier, return_to, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (state, verifier, safe_return, now),
        )

    query = urlencode(
        {
            "client_id": cfg.client_id,
            "response_type": "code",
            "redirect_uri": cfg.redirect_uri,
            "response_mode": "query",
            "scope": OAUTH_SCOPES,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return RedirectResponse(url=f"{cfg.authorize_url}?{query}", status_code=302)


@router.get("/auth/outlook/callback")
def outlook_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    cfg = get_outlook_config()
    store: Store = request.app.state.store
    return_to = "/invoices"

    if state:
        with store.connect() as conn:
            row = conn.execute(
                "SELECT code_verifier, return_to, created_at FROM outlook_oauth_states WHERE state = ?",
                (state,),
            ).fetchone()
            conn.execute("DELETE FROM outlook_oauth_states WHERE state = ?", (state,))
    else:
        row = None

    if row is not None:
        return_to = str(row["return_to"] or "/invoices")

    if error:
        msg = (error_description or error).strip()
        return _frontend_redirect(cfg, return_to, {"outlook_error": msg[:240]})

    if row is None or not code:
        return _frontend_redirect(
            cfg,
            return_to,
            {
                "outlook_error": "Invalid or expired OAuth state. Please try connecting Outlook again."
            },
        )

    if float(row["created_at"]) < time.time() - STATE_TTL_SECONDS:
        return _frontend_redirect(
            cfg,
            return_to,
            {
                "outlook_error": "OAuth login session timed out. Please try connecting Outlook again."
            },
        )

    try:
        token_data = _exchange_code_for_tokens(cfg, code, str(row["code_verifier"]))
    except HTTPException as exc:
        return _frontend_redirect(cfg, return_to, {"outlook_error": str(exc.detail)[:240]})
    except Exception as exc:
        return _frontend_redirect(
            cfg,
            return_to,
            {"outlook_error": f"Could not reach Microsoft token endpoint: {exc}"[:240]},
        )

    access_token = str(token_data.get("access_token") or "")
    refresh_token = str(token_data.get("refresh_token") or "")
    expires_in = int(token_data.get("expires_in") or 3600)
    if not access_token:
        return _frontend_redirect(
            cfg, return_to, {"outlook_error": "Microsoft did not return an access token."}
        )

    profile = _fetch_graph_profile(access_token)
    claims = _decode_id_token_claims(token_data.get("id_token"))
    email = (
        profile.get("mail")
        or profile.get("userPrincipalName")
        or claims.get("email")
        or claims.get("preferred_username")
        or "Connected Account"
    )
    display_name = profile.get("displayName") or claims.get("name") or email

    encrypted = encrypt_tokens(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
        },
        cfg.client_secret,
    )
    connected_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    with store.connect() as conn:
        conn.execute(
            """
            INSERT INTO outlook_connections (id, email, display_name, encrypted_tokens, connected_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                encrypted_tokens = excluded.encrypted_tokens,
                connected_at = excluded.connected_at
            """,
            (str(email), str(display_name), encrypted, connected_at),
        )

    return _frontend_redirect(cfg, return_to, {"outlook": "connected"})


@router.get("/outlook/status", response_model=OutlookStatusResponse)
def outlook_status(request: Request):
    cfg = get_outlook_config()
    store: Store = request.app.state.store
    with store.connect() as conn:
        row = conn.execute(
            "SELECT email, display_name, connected_at FROM outlook_connections WHERE id = 1"
        ).fetchone()
    if row is None or not cfg.configured:
        return OutlookStatusResponse(
            configured=cfg.configured,
            connected=False,
            redirectUri=cfg.redirect_uri,
        )
    return OutlookStatusResponse(
        configured=True,
        connected=True,
        email=row["email"],
        displayName=row["display_name"],
        connectedAt=row["connected_at"],
        redirectUri=cfg.redirect_uri,
    )


@router.post("/outlook/disconnect", response_model=OutlookStatusResponse)
def outlook_disconnect(request: Request):
    cfg = get_outlook_config()
    store: Store = request.app.state.store
    with store.connect() as conn:
        conn.execute("DELETE FROM outlook_connections WHERE id = 1")
        conn.execute("DELETE FROM outlook_oauth_states")
    return OutlookStatusResponse(
        configured=cfg.configured,
        connected=False,
        redirectUri=cfg.redirect_uri,
    )


@router.get("/outlook/messages", response_model=OutlookMessagesResponse)
def list_outlook_messages(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    only_attachments: bool = False,
    search: str = "",
):
    cfg = get_outlook_config()
    store: Store = request.app.state.store
    fetch_top = min(50, max(limit * 2, 30)) if (only_attachments or search.strip()) else limit

    payload = _graph_get(
        store,
        cfg,
        "/me/mailFolders/inbox/messages",
        params={
            "$top": fetch_top,
            "$select": "id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments,webLink",
            "$orderby": "receivedDateTime desc",
        },
        prefer_text=True,
    )

    raw_items = payload.get("value") or []
    needle = search.strip().lower()
    results: list[OutlookMessageSummary] = []

    for item in raw_items:
        summary = _parse_message_summary(item)
        if only_attachments and not summary.hasAttachments:
            continue
        if needle:
            haystack = " ".join(
                [
                    summary.subject.lower(),
                    summary.senderName.lower(),
                    summary.senderEmail.lower(),
                    summary.bodyText.lower(),
                ]
            )
            if needle not in haystack:
                continue
        results.append(summary)
        if len(results) >= limit:
            break

    return OutlookMessagesResponse(messages=results)


@router.get("/outlook/messages/{message_id}", response_model=OutlookMessageDetail)
def get_outlook_message(request: Request, message_id: str):
    cfg = get_outlook_config()
    store: Store = request.app.state.store

    msg_data = _graph_get(
        store,
        cfg,
        f"/me/messages/{message_id}",
        params={
            "$select": "id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments,webLink",
        },
        prefer_text=True,
    )
    summary = _parse_message_summary(msg_data)

    att_data = _graph_get(
        store,
        cfg,
        f"/me/messages/{message_id}/attachments",
        params={"$select": "id,name,contentType,size,isInline"},
    )
    attachments: list[OutlookAttachmentSummary] = []
    for att in att_data.get("value") or []:
        name = str(att.get("name") or "attachment")
        content_type = str(att.get("contentType") or "application/octet-stream")
        size = int(att.get("size") or 0)
        is_pdf = content_type.lower() == "application/pdf" or name.lower().endswith(".pdf")
        attachments.append(
            OutlookAttachmentSummary(
                id=str(att.get("id") or ""),
                name=name,
                contentType=content_type,
                size=size,
                isPdf=is_pdf,
            )
        )

    return OutlookMessageDetail(
        **summary.model_dump(),
        attachments=attachments,
    )


@router.get("/outlook/messages/{message_id}/attachments/{attachment_id}/file")
def download_outlook_attachment(
    request: Request,
    message_id: str,
    attachment_id: str,
):
    cfg = get_outlook_config()
    store: Store = request.app.state.store

    att = _graph_get(
        store,
        cfg,
        f"/me/messages/{message_id}/attachments/{attachment_id}",
    )
    content_b64 = att.get("contentBytes")
    if not content_b64:
        raise HTTPException(
            status_code=422,
            detail="This attachment does not contain inline file bytes.",
        )
    try:
        raw_bytes = base64.b64decode(content_b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not decode attachment bytes.") from exc

    name = (
        str(att.get("name") or "invoice.pdf").replace('"', "").replace("\r", "").replace("\n", "")
    )
    content_type = str(att.get("contentType") or "application/pdf")
    if name.lower().endswith(".pdf"):
        content_type = "application/pdf"

    return Response(
        content=raw_bytes,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )
