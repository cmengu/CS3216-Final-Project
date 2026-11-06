"""Ollama requests with an authenticated backup and a separate startup allowance."""

import hashlib
import json
import logging
import math
import os
import threading
import time
from urllib.parse import urlsplit

import httpx

log = logging.getLogger(__name__)
_lock = threading.Lock()
_credentials = {}
_unavailable_until: dict[str, float] = {}


def _seconds(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a positive number of seconds") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number of seconds")
    return value


def cloud_run_audience(base_url: str) -> str | None:
    url = urlsplit(base_url)
    if not (url.hostname or "").lower().endswith(".run.app"):
        return None
    if (
        url.scheme != "https"
        or url.username
        or url.password
        or url.port
        or url.path not in ("", "/")
        or url.query
        or url.fragment
    ):
        raise ValueError("Use the Cloud Run HTTPS service URL without a path or credentials")
    return f"https://{url.hostname}"


def cloud_run_headers(base_url: str, timeout_seconds: float = 15) -> dict[str, str]:
    audience = cloud_run_audience(base_url)
    if audience is None:
        return {}
    try:
        import requests
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
        from google.oauth2.id_token import fetch_id_token_credentials

        deadline = time.monotonic() + timeout_seconds
        credential_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        key = (
            audience,
            os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
            hashlib.sha256(credential_json.encode()).hexdigest(),
        )
        with _lock, requests.Session() as session:
            request = Request(session=session)

            def bounded_request(*args, **kwargs):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Authentication deadline expired")
                kwargs["timeout"] = min(5.0, remaining)
                return request(*args, **kwargs)

            credentials = _credentials.get(key)
            if credentials is None:
                if credential_json:
                    credentials = service_account.IDTokenCredentials.from_service_account_info(
                        json.loads(credential_json), target_audience=audience
                    )
                else:
                    credentials = fetch_id_token_credentials(audience, request=bounded_request)
                _credentials[key] = credentials
            if not credentials.valid:
                credentials.refresh(bounded_request)
            if not credentials.token:
                raise ValueError("No ID token returned")
            return {"Authorization": f"Bearer {credentials.token}"}
    except Exception:
        # Provider errors can contain credential details. Keep them out of saved invoice errors.
        raise ValueError(
            "Cloud Run authentication failed. Configure GOOGLE_SERVICE_ACCOUNT_JSON "
            "or GOOGLE_APPLICATION_CREDENTIALS "
            "and grant its service account Cloud Run Invoker."
        ) from None


def _retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (
        exc.response.status_code in (408, 429) or exc.response.status_code >= 500
    )


def _model_is_downloading(exc: Exception) -> bool:
    if not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code != 404:
        return False
    try:
        body = exc.response.json()
    except ValueError:
        return False
    message = str(body.get("error", "")).lower() if isinstance(body, dict) else ""
    return "model" in message and "not found" in message


def _post(base_url, path, payload, timeout, client_factory, *, headers):
    options = {"headers": headers} if headers else {}
    with client_factory(timeout=timeout) as client:
        response = client.post(f"{base_url.rstrip('/')}{path}", json=payload, **options)
        response.raise_for_status()
        return response.json()


def _remaining(limit, deadline):
    remaining = min(limit, deadline - time.monotonic()) if deadline is not None else limit
    if remaining <= 0:
        raise ValueError("The model request budget expired")
    return remaining


def _wait_for_cloud_model(base_url, payload, startup_seconds, client_factory):
    """An empty generate loads the model without spending invoice generation time."""
    deadline = time.monotonic() + startup_seconds
    preload = {
        "model": payload["model"],
        "stream": False,
        "keep_alive": payload.get("keep_alive", "60m"),
        "options": {"num_ctx": payload.get("options", {}).get("num_ctx", 8192)},
    }
    log.info("Waiting up to %.0f seconds for the Cloud Run model to start", startup_seconds)
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        headers = cloud_run_headers(base_url, min(15.0, remaining))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            result = _post(
                base_url,
                "/api/generate",
                preload,
                httpx.Timeout(remaining, connect=min(10.0, remaining)),
                client_factory,
                headers=headers,
            )
            if result.get("done") is True:
                return
            raise ValueError("The model did not confirm that startup finished")
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            if not (_retryable(exc) or _model_is_downloading(exc)):
                raise
            # A platform 504 can arrive while Ollama keeps loading. Retry the idempotent
            # preload within the original deadline, never the invoice generation request.
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(3.0, remaining))
    raise ValueError(
        f"The backup model was not ready after {startup_seconds:g} seconds. "
        "Check Cloud Run startup logs and the saved model files, then retry."
    )


def _request(
    base_url,
    payload,
    timeout_seconds,
    startup_seconds,
    client_factory,
    *,
    fast=False,
    deadline=None,
):
    is_cloud_run = cloud_run_audience(base_url) is not None
    if is_cloud_run:
        _wait_for_cloud_model(
            base_url, payload, _remaining(startup_seconds, deadline), client_factory
        )
    headers = cloud_run_headers(base_url, _remaining(15.0, deadline))
    timeout_seconds = _remaining(timeout_seconds, deadline)
    timeout = (
        httpx.Timeout(timeout_seconds, connect=min(3.0, timeout_seconds))
        if fast
        else timeout_seconds
    )
    return _post(base_url, "/api/chat", payload, timeout, client_factory, headers=headers)


def request_ollama(base_url, payload, *, client_factory=httpx.Client, deadline=None):
    """Keep startup and inference budgets separate, and fail over on service failures."""
    timeout = _seconds("OLLAMA_REQUEST_TIMEOUT_SECONDS", 120)
    startup = _seconds("OLLAMA_STARTUP_TIMEOUT_SECONDS", 600)
    primary = base_url.rstrip("/")
    backup = os.environ.get("OLLAMA_FALLBACK_BASE_URL", "").strip().rstrip("/")
    if backup == primary:
        backup = ""
    with _lock:
        skip_primary = bool(backup) and _unavailable_until.get(primary, 0) > time.monotonic()
    if not skip_primary:
        try:
            result = _request(
                primary,
                payload,
                min(timeout, 8.0) if backup else timeout,
                startup,
                client_factory,
                fast=bool(backup),
                deadline=deadline,
            )
            with _lock:
                _unavailable_until.pop(primary, None)
            return result
        except Exception as exc:
            if not backup or not _retryable(exc):
                raise
            with _lock:
                _unavailable_until[primary] = time.monotonic() + 30
            log.warning("Primary model service unavailable; waiting for the backup model")

    setting = (
        "OLLAMA_FALLBACK_MODEL"
        if payload["model"] == os.environ.get("OPENAI_MODEL", "gemma4:e4b")
        else "OLLAMA_FALLBACK_CHALLENGER_MODEL"
    )
    model = os.environ.get(setting, "").strip() or payload["model"]
    backup_payload = {**payload, "model": model}
    return _request(backup, backup_payload, timeout, startup, client_factory, deadline=deadline)
