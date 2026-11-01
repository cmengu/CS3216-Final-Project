"""First-admin creation only after proving control of the operator-approved inbox."""

import hmac
import secrets

from fastapi import HTTPException

from . import security_mail
from .mfa import CHALLENGE_SECONDS, MAX_ATTEMPTS, _code_hash, _digest, masked_email, now_seconds
from .passwords import hash_password


class AdministratorSetup:
    def __init__(self, accounts):
        self.accounts = accounts
        self.table = accounts.table
        self.execute = accounts.execute
        with accounts.connect() as db:
            for name, columns in {
                "admin_setup_codes": """id TEXT PRIMARY KEY, email TEXT NOT NULL,
                    code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0""",
                "admin_setup_grants": "id TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at BIGINT NOT NULL",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")

    def _open(self, db, email=None):
        if self.execute(db, f"SELECT 1 FROM {self.table('approved_accounts')} LIMIT 1").fetchone():
            raise HTTPException(409, "Administrator setup is complete. Sign in instead.")
        if email is not None and email != self.accounts.mfa.admin_email():
            raise HTTPException(401, "The approved administrator email changed. Start setup again.")

    def start(self):
        email = self.accounts.mfa.admin_email()
        with self.accounts.connect() as db:
            self._open(db)
        security_mail.ensure_ready(email)
        limits = self.accounts.mfa.limits
        limits.take("admin-email-cooldown", email, maximum=1, seconds=60)
        limits.take("admin-emails-hour", email, maximum=10, seconds=3600)
        token, code = secrets.token_urlsafe(32), f"{secrets.randbelow(1000000):06d}"
        token_hash = _digest(token)
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self._open(db, email)
            self.execute(db, f"DELETE FROM {self.table('admin_setup_codes')}")
            self.execute(
                db,
                f"DELETE FROM {self.table('admin_setup_grants')} WHERE expires_at<=?",
                (now_seconds(),),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('admin_setup_codes')} (id,email,code_hash,expires_at) VALUES (?,?,?,?)",
                (
                    token_hash,
                    email,
                    _code_hash("admin-setup:" + token_hash, code),
                    now_seconds() + CHALLENGE_SECONDS,
                ),
            )
        try:
            security_mail.send_code(email, code, token_hash)
        except BaseException:
            with self.accounts.connect() as db:
                self.execute(
                    db, f"DELETE FROM {self.table('admin_setup_codes')} WHERE id=?", (token_hash,)
                )
            raise
        return {
            "mfa_required": True,
            "challenge_id": token,
            "destination": masked_email(email),
            "expires_in": CHALLENGE_SECONDS,
            "resend_after": 60,
        }

    def resend(self, token):
        with self.accounts.connect() as db:
            self._open(db)
            row = self.execute(
                db,
                f"SELECT email FROM {self.table('admin_setup_codes')} WHERE id=? AND expires_at>? AND attempts<?",
                (_digest(token), now_seconds(), MAX_ATTEMPTS),
            ).fetchone()
            if not row:
                raise HTTPException(401, "This verification has expired. Start setup again.")
            self._open(db, row["email"])
        return self.start()

    def verify(self, token, code):
        email = self.accounts.mfa.admin_email()
        self.accounts.mfa.limits.take("admin-email-verify", email, maximum=15, seconds=600)
        error, grant = None, None
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self._open(db)
            row = self.execute(
                db, f"SELECT * FROM {self.table('admin_setup_codes')} WHERE id=?", (_digest(token),)
            ).fetchone()
            if not row or row["expires_at"] <= now_seconds() or row["attempts"] >= MAX_ATTEMPTS:
                error = "This verification has expired. Start setup again."
            elif row["email"] != email:
                error = "The approved email changed. Start setup again."
            elif not hmac.compare_digest(
                _code_hash("admin-setup:" + _digest(token), code), row["code_hash"]
            ):
                self.execute(
                    db,
                    f"UPDATE {self.table('admin_setup_codes')} SET attempts=attempts+1 WHERE id=?",
                    (_digest(token),),
                )
                error = "That security code is incorrect. Check the most recent email."
            else:
                grant = secrets.token_urlsafe(32)
                self.execute(
                    db,
                    f"DELETE FROM {self.table('admin_setup_codes')} WHERE id=?",
                    (_digest(token),),
                )
                self.execute(
                    db,
                    f"INSERT INTO {self.table('admin_setup_grants')} (id,email,expires_at) VALUES (?,?,?)",
                    (_digest(grant), email, now_seconds() + CHALLENGE_SECONDS),
                )
        if error:
            raise HTTPException(401, error)
        return {"setup_grant": grant, "expires_in": CHALLENGE_SECONDS}

    def _grant(self, db, token):
        self._open(db)
        row = self.execute(
            db,
            f"SELECT email FROM {self.table('admin_setup_grants')} WHERE id=? AND expires_at>?",
            (_digest(token), now_seconds()),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Email verification has expired. Start setup again.")
        self._open(db, row["email"])
        return row["email"]

    def complete(self, token, username, password):
        from .accounts import clean_username

        # Reject unverified requests before doing memory-hard password hashing.
        with self.accounts.connect() as db:
            self._grant(db, token)
        username = clean_username(username)
        password_hash = hash_password(password)
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            email = self._grant(db, token)
            user_id = self.accounts._insert(db, username, password_hash, "admin", None, None)
            self.accounts.mfa.assign_email(db, user_id, email)
            self.execute(
                db,
                f"UPDATE {self.table('account_email')} SET verified=1 WHERE user_id=?",
                (user_id,),
            )
            self.execute(db, f"DELETE FROM {self.table('admin_setup_codes')}")
            self.execute(db, f"DELETE FROM {self.table('admin_setup_grants')}")
            self.accounts._event(db, user_id, user_id, "administrator_email_setup_completed")
        return self.accounts.get_user(user_id)
