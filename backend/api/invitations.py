"""Per-email, single-use invitation links and explicit administrator delivery status."""

import os
import secrets
from urllib.parse import urlsplit

from fastapi import HTTPException

from . import security_mail
from .mfa import CHALLENGE_SECONDS, _digest, now_seconds

INVITATION_SECONDS = 24 * 60 * 60


def frontend_url():
    value = os.environ.get("FRONTEND_URL", "http://localhost:3000").strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path
    ):
        raise ValueError("Configure FRONTEND_URL with the app's public website origin.")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Hosted invitations require an HTTPS FRONTEND_URL.")
    return value


class Invitations:
    def __init__(self, enrollment):
        self.enrollment = enrollment
        self.accounts = enrollment.accounts
        self.table, self.execute = enrollment.table, enrollment.execute
        with self.accounts.connect() as db:
            for name, columns in {
                "enrollment_invitations": "id TEXT PRIMARY KEY, approval_id TEXT NOT NULL, expires_at BIGINT NOT NULL",
                "invitation_delivery": "approval_id TEXT PRIMARY KEY, status TEXT NOT NULL, error TEXT, updated_at BIGINT NOT NULL",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")

    def _status(self, db, approval_id, status, error=None):
        self.execute(
            db,
            f"INSERT INTO {self.table('invitation_delivery')} (approval_id,status,error,updated_at) VALUES (?,?,?,?) ON CONFLICT(approval_id) DO UPDATE SET status=excluded.status,error=excluded.error,updated_at=excluded.updated_at",
            (approval_id, status, error, now_seconds()),
        )
        return {"invitation_status": status, "invitation_error": error}

    def send(self, approval_id, *, actor, actor_session):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self.accounts._check_admin(db, actor, actor_session)
            email = self.enrollment._pending(db, approval_id)["email"]
        token_hash = None
        try:
            try:
                origin = frontend_url()
            except ValueError as exc:
                raise HTTPException(503, str(exc)) from None
            security_mail.ensure_ready(email)
            self.accounts.mfa.limits.take("invitation-cooldown", approval_id, maximum=1, seconds=60)
            self.accounts.mfa.limits.take("invitation-hour", approval_id, maximum=10, seconds=3600)
            token = secrets.token_urlsafe(32)
            token_hash = _digest(token)
            with self.accounts.connect() as db:
                self.accounts._lock(db)
                self.accounts._check_admin(db, actor, actor_session)
                self.enrollment._pending(db, approval_id)
                self.execute(
                    db,
                    f"DELETE FROM {self.table('enrollment_invitations')} WHERE approval_id=? OR expires_at<=?",
                    (approval_id, now_seconds()),
                )
                self.execute(
                    db,
                    f"INSERT INTO {self.table('enrollment_invitations')} (id,approval_id,expires_at) VALUES (?,?,?)",
                    (token_hash, approval_id, now_seconds() + INVITATION_SECONDS),
                )
                self._status(db, approval_id, "sending")
            # Fragment keeps the bearer secret out of frontend requests and access logs.
            security_mail.send_invitation(email, origin + "/join#invite=" + token, token_hash)
        except HTTPException as exc:
            if exc.status_code != 503:
                raise
            with self.accounts.connect() as db:
                if token_hash:
                    self.execute(
                        db,
                        f"DELETE FROM {self.table('enrollment_invitations')} WHERE id=?",
                        (token_hash,),
                    )
                return self._status(db, approval_id, "failed", str(exc.detail))
        with self.accounts.connect() as db:
            return self._status(db, approval_id, "sent")

    def claim(self, token):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            row = self.execute(
                db,
                f"SELECT approval_id FROM {self.table('enrollment_invitations')} WHERE id=? AND expires_at>?",
                (_digest(token), now_seconds()),
            ).fetchone()
            if not row:
                raise HTTPException(
                    401,
                    "This invitation has expired or was already used. Ask your administrator to resend it.",
                )
            approval = self.enrollment._pending(db, row["approval_id"])
            grant = secrets.token_urlsafe(32)
            self.execute(
                db,
                f"DELETE FROM {self.table('enrollment_invitations')} WHERE id=?",
                (_digest(token),),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('enrollment_grants')} (id,approval_id,expires_at) VALUES (?,?,?)",
                (_digest(grant), approval["id"], now_seconds() + CHALLENGE_SECONDS),
            )
        return {"setup_grant": grant, "email": approval["email"], "expires_in": CHALLENGE_SECONDS}
