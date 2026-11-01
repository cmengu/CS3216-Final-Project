"""Email-only approval followed by inbox proof and self-chosen credentials."""

import hmac
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException

from . import security_mail
from .invitations import Invitations
from .mfa import CHALLENGE_SECONDS, MAX_ATTEMPTS, _code_hash, _digest, masked_email, now_seconds
from .passwords import hash_password


class Enrollment:
    def __init__(self, accounts):
        self.accounts = accounts
        self.table, self.execute = accounts.table, accounts.execute
        with accounts.connect() as db:
            for name, columns in {
                "account_approvals": """id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                    actor TEXT NOT NULL, created_at BIGINT NOT NULL""",
                "enrollment_codes": """id TEXT PRIMARY KEY, approval_id TEXT NOT NULL,
                    code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0""",
                "enrollment_grants": """id TEXT PRIMARY KEY, approval_id TEXT NOT NULL,
                    expires_at BIGINT NOT NULL""",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")

        self.invitations = Invitations(self)

    def list_approvals(self):
        with self.accounts.connect() as db:
            return [
                dict(row)
                for row in self.execute(
                    db,
                    f"SELECT a.id,a.email,a.created_at,COALESCE(d.status,'not_sent') AS invitation_status,d.error AS invitation_error FROM {self.table('account_approvals')} a LEFT JOIN {self.table('invitation_delivery')} d ON d.approval_id=a.id ORDER BY a.created_at,a.id",
                ).fetchall()
            ]

    def approve(self, email, *, actor, actor_session):
        email = security_mail.normalize_email(email)
        approval_id, created = str(uuid4()), int(time.time())
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self.accounts._check_admin(db, actor, actor_session)
            if self.execute(
                db, f"SELECT 1 FROM {self.table('account_email')} WHERE email=?", (email,)
            ).fetchone():
                raise HTTPException(409, "That email already belongs to an account.")
            if self.execute(
                db, f"SELECT 1 FROM {self.table('account_approvals')} WHERE email=?", (email,)
            ).fetchone():
                raise HTTPException(409, "That email is already approved and waiting for setup.")
            self.execute(
                db,
                f"INSERT INTO {self.table('account_approvals')} (id,email,actor,created_at) VALUES (?,?,?,?)",
                (approval_id, email, actor, created),
            )
            self.accounts._event(db, actor, approval_id, "email_approved")
        return {"id": approval_id, "email": email, "created_at": created}

    def revoke(self, approval_id, *, actor, actor_session):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self.accounts._check_admin(db, actor, actor_session)
            if not self.execute(
                db, f"DELETE FROM {self.table('account_approvals')} WHERE id=?", (approval_id,)
            ).rowcount:
                raise HTTPException(404, "Pending approval not found.")
            for name in (
                "enrollment_codes",
                "enrollment_grants",
                "enrollment_invitations",
                "invitation_delivery",
            ):
                self.execute(
                    db, f"DELETE FROM {self.table(name)} WHERE approval_id=?", (approval_id,)
                )
            self.accounts._event(db, actor, approval_id, "email_approval_revoked")
        return {"ok": True}

    def _pending(self, db, approval_id):
        row = self.execute(
            db, f"SELECT * FROM {self.table('account_approvals')} WHERE id=?", (approval_id,)
        ).fetchone()
        if (
            not row
            or self.execute(
                db, f"SELECT 1 FROM {self.table('account_email')} WHERE email=?", (row["email"],)
            ).fetchone()
        ):
            raise HTTPException(
                401, "This approval is no longer available. Ask your administrator."
            )
        return row

    def start(self, email):
        email = security_mail.normalize_email(email)
        limits = self.accounts.mfa.limits
        limits.take("enrollment-email-cooldown", email, maximum=1, seconds=60)
        limits.take("enrollment-emails-hour", email, maximum=10, seconds=3600)
        token = secrets.token_urlsafe(32)
        challenge = {
            "mfa_required": True,
            "challenge_id": token,
            "destination": masked_email(email),
            "expires_in": CHALLENGE_SECONDS,
            "resend_after": 60,
        }
        with self.accounts.connect() as db:
            row = self.execute(
                db, f"SELECT id FROM {self.table('account_approvals')} WHERE email=?", (email,)
            ).fetchone()
        # Same public response for unknown or already registered addresses; send nothing.
        if not row:
            return challenge
        security_mail.ensure_ready(email)
        token_hash, code = _digest(token), f"{secrets.randbelow(1000000):06d}"
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            approval = self._pending(db, row["id"])
            self.execute(
                db,
                f"DELETE FROM {self.table('enrollment_codes')} WHERE approval_id=? OR expires_at<=?",
                (approval["id"], now_seconds()),
            )
            self.execute(
                db,
                f"DELETE FROM {self.table('enrollment_grants')} WHERE expires_at<=?",
                (now_seconds(),),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('enrollment_codes')} (id,approval_id,code_hash,expires_at) VALUES (?,?,?,?)",
                (
                    token_hash,
                    approval["id"],
                    _code_hash("enrollment:" + token_hash, code),
                    now_seconds() + CHALLENGE_SECONDS,
                ),
            )
        try:
            security_mail.send_code(email, code, token_hash)
        except BaseException:
            with self.accounts.connect() as db:
                self.execute(
                    db, f"DELETE FROM {self.table('enrollment_codes')} WHERE id=?", (token_hash,)
                )
            raise
        return challenge

    def resend(self, token):
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT approval_id FROM {self.table('enrollment_codes')} WHERE id=? AND expires_at>? AND attempts<?",
                (_digest(token), now_seconds(), MAX_ATTEMPTS),
            ).fetchone()
            if not row:
                raise HTTPException(
                    401, "This verification has expired. Start account setup again."
                )
            email = self._pending(db, row["approval_id"])["email"]
        return self.start(email)

    def verify(self, token, code):
        token_hash = _digest(token)
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT approval_id FROM {self.table('enrollment_codes')} WHERE id=?",
                (token_hash,),
            ).fetchone()
        if row:
            self.accounts.mfa.limits.take(
                "enrollment-verify", row["approval_id"], maximum=15, seconds=600
            )
        error, grant = None, None
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            row = self.execute(
                db, f"SELECT * FROM {self.table('enrollment_codes')} WHERE id=?", (token_hash,)
            ).fetchone()
            if not row or row["expires_at"] <= now_seconds() or row["attempts"] >= MAX_ATTEMPTS:
                error = "This verification has expired. Start account setup again."
            else:
                self._pending(db, row["approval_id"])
                if not hmac.compare_digest(
                    _code_hash("enrollment:" + token_hash, code), row["code_hash"]
                ):
                    self.execute(
                        db,
                        f"UPDATE {self.table('enrollment_codes')} SET attempts=attempts+1 WHERE id=?",
                        (token_hash,),
                    )
                    error = "That security code is incorrect. Check the most recent email."
                else:
                    grant = secrets.token_urlsafe(32)
                    self.execute(
                        db,
                        f"DELETE FROM {self.table('enrollment_codes')} WHERE id=?",
                        (token_hash,),
                    )
                    self.execute(
                        db,
                        f"INSERT INTO {self.table('enrollment_grants')} (id,approval_id,expires_at) VALUES (?,?,?)",
                        (_digest(grant), row["approval_id"], now_seconds() + CHALLENGE_SECONDS),
                    )
        if error:
            raise HTTPException(401, error)
        return {"setup_grant": grant, "expires_in": CHALLENGE_SECONDS}

    def _grant(self, db, token):
        row = self.execute(
            db,
            f"SELECT approval_id FROM {self.table('enrollment_grants')} WHERE id=? AND expires_at>?",
            (_digest(token), now_seconds()),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Email verification has expired. Start account setup again.")
        return self._pending(db, row["approval_id"])

    def complete(self, token, username, password):
        from .accounts import clean_username

        with self.accounts.connect() as db:
            self._grant(db, token)
        username, password_hash = clean_username(username), hash_password(password)
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            approval = self._grant(db, token)
            # The public setup endpoint cannot select a role or workspace.
            user_id = self.accounts._insert(
                db, username, password_hash, "member", None, approval["actor"]
            )
            self.accounts.mfa.assign_email(db, user_id, approval["email"])
            self.execute(
                db,
                f"UPDATE {self.table('account_email')} SET verified=1 WHERE user_id=?",
                (user_id,),
            )
            for name in (
                "enrollment_codes",
                "enrollment_grants",
                "enrollment_invitations",
                "invitation_delivery",
            ):
                self.execute(
                    db, f"DELETE FROM {self.table(name)} WHERE approval_id=?", (approval["id"],)
                )
            self.execute(
                db, f"DELETE FROM {self.table('account_approvals')} WHERE id=?", (approval["id"],)
            )
            self.accounts._event(db, user_id, user_id, "approved_account_enrolled")
        return self.accounts.get_user(user_id)
