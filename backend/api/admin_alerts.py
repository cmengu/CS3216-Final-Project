"""Tell the administrator about setup problems the clerk cannot fix.

Users see one plain sentence; the details go by AgentMail to AUTH_ADMIN_EMAIL, at most
once a day per problem. Delivery never blocks or fails the user's request.
"""

import logging
import os
import secrets
import threading
import time

from . import security_mail

log = logging.getLogger(__name__)

ONCE_PER = 24 * 60 * 60
_sent: dict[str, float] = {}
_lock = threading.Lock()


def _due(key: str, now: float) -> bool:
    with _lock:
        if now - _sent.get(key, 0) < ONCE_PER:
            return False
        _sent[key] = now
        return True


def _deliver(recipient: str, subject: str, body: str) -> None:
    try:
        security_mail._agentmail_send(recipient, subject, body, "alert-" + secrets.token_hex(8))
    except Exception:  # noqa: BLE001 - an alert must never surface to the user
        log.warning("Administrator alert could not be sent by AgentMail")


def _in_background(fn, *args) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def notify_admin(key: str, subject: str, body: str, *, now: float | None = None) -> bool:
    """Send the alert in the background unless one went out for `key` in the last day."""
    recipient = os.environ.get("AUTH_ADMIN_EMAIL", "").strip()
    if not recipient:
        log.warning("Administrator alert skipped: AUTH_ADMIN_EMAIL is not set")
        return False
    if not _due(key, time.time() if now is None else now):
        return False
    _in_background(_deliver, recipient, subject, body)
    return True
