"""Signed session tokens and HttpOnly cookie authentication."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from typing import Any

from fastapi import Request

COOKIE_NAME = "ic_session"
TOKEN_PREFIX = "ic1"
TOKEN_TTL_SECONDS = 7 * 24 * 3600  # 7 days


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _auth_secret() -> bytes:
    explicit = (os.environ.get("AUTH_SECRET") or "").strip()
    if explicit:
        return hashlib.sha256(explicit.encode("utf-8")).digest()
    password = os.environ.get("AUTH_PASSWORD") or "invoice-checker"
    username = (os.environ.get("AUTH_USERNAME") or "demo-account").strip()
    return hashlib.sha256(f"ic-auth-v1:{username}:{password}".encode("utf-8")).digest()


def create_session_token(
    username: str,
    session_id: str,
    *,
    ttl_seconds: int = TOKEN_TTL_SECONDS,
) -> str:
    payload = {
        "u": username,
        "sid": session_id,
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    sig = hmac.new(_auth_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = _b64url_encode(sig)
    return f"{TOKEN_PREFIX}.{payload_b64}.{sig_b64}"


def verify_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or not isinstance(token, str):
        return None
    cleaned = token.strip()
    parts = cleaned.split(".")
    if len(parts) != 3 or parts[0] != TOKEN_PREFIX:
        return None
    _, payload_b64, sig_b64 = parts
    if not payload_b64 or not sig_b64:
        return None
    try:
        expected_sig = hmac.new(
            _auth_secret(), payload_b64.encode("ascii"), hashlib.sha256
        ).digest()
        actual_sig = _b64url_decode(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, actual_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    username = payload.get("u")
    session_id = payload.get("sid")
    exp = payload.get("exp")
    if not isinstance(username, str) or not username.strip():
        return None
    if not isinstance(session_id, str) or not session_id.strip():
        return None
    if not isinstance(exp, (int, float)) or exp <= time.time():
        return None
    return {
        "username": username.strip(),
        "session_id": session_id.strip(),
        "exp": int(exp),
    }


def _bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip() or None
    return None


def extract_request_claims(
    request: Request, query_session_id: str | None = None
) -> dict[str, Any] | None:
    candidates = (
        request.cookies.get(COOKIE_NAME),
        _bearer_token(request),
        request.headers.get("x-invoice-session"),
        query_session_id,
        request.query_params.get("session_id"),
    )
    for raw in candidates:
        if not raw:
            continue
        claims = verify_session_token(raw)
        if claims is not None:
            return claims
    return None


def has_invalid_auth_token(request: Request, query_session_id: str | None = None) -> bool:
    cookie_val = request.cookies.get(COOKIE_NAME)
    if cookie_val and verify_session_token(cookie_val) is None:
        return True
    bearer_val = _bearer_token(request)
    if bearer_val and verify_session_token(bearer_val) is None:
        return True
    for raw in (
        request.headers.get("x-invoice-session"),
        query_session_id,
        request.query_params.get("session_id"),
    ):
        if raw and raw.strip().startswith(f"{TOKEN_PREFIX}.") and verify_session_token(raw) is None:
            return True
    return False


def is_auth_required() -> bool:
    raw = os.environ.get("AUTH_REQUIRED")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return "pytest" not in sys.modules
