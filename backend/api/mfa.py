"""Password-bound, one-use email codes sent only to an approved address."""

import hashlib
import hmac
import os
import re
import secrets
import time

from fastapi import HTTPException

from . import security_mail
from .limits import UsageLimits

CHALLENGE_SECONDS = 300
MAX_ATTEMPTS = 5


def now_seconds():
    return int(time.time())


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _code_hash(token_hash, code):
    key = (os.environ.get("AUTH_MFA_KEY") or os.environ.get("AUTH_SECRET") or "").strip()
    if len(key) < 32:
        raise ValueError("Keep AUTH_SECRET configured with at least 32 random characters.")
    return hmac.new(
        key.encode(), ("email-code:v1:" + token_hash + ":" + code).encode(), hashlib.sha256
    ).hexdigest()


def masked_email(email):
    local, domain = email.rsplit("@", 1)
    return local[0] + "***@" + domain


class TwoFactor:
    def __init__(self, accounts):
        self.accounts = accounts
        self.table = accounts.table
        self.execute = accounts.execute
        self.limits = UsageLimits(accounts.store)
        with accounts.connect() as db:
            for name, columns in {
                "account_email": """user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                    version BIGINT NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0""",
                "email_challenges": """id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    account_version BIGINT NOT NULL, email_version BIGINT NOT NULL,
                    code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0""",
                "email_login_sessions": "id TEXT PRIMARY KEY",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")
            self.execute(
                db,
                f"CREATE INDEX IF NOT EXISTS email_challenge_expiry ON {self.table('email_challenges')}(expires_at)",
            )

    def required(self, user):
        return True

    def needs_verification(self, user):
        return self.required(user)

    def factor(self, db, user_id):
        return self.execute(
            db, f"SELECT * FROM {self.table('account_email')} WHERE user_id=?", (user_id,)
        ).fetchone()

    def admin_email(self):
        try:
            return security_mail.normalize_email(os.environ.get("AUTH_ADMIN_EMAIL", ""))
        except ValueError:
            raise HTTPException(
                503,
                "The operator must configure the first administrator's email address before setup.",
            ) from None

    def assign_email(self, db, user_id, email):
        email = security_mail.normalize_email(email)
        other = self.execute(
            db,
            f"SELECT 1 FROM {self.table('account_email')} WHERE email=? AND user_id!=?",
            (email, user_id),
        ).fetchone()
        if other:
            raise HTTPException(
                409, "That email address already belongs to another approved account."
            )
        self.execute(
            db,
            f"INSERT INTO {self.table('account_email')} (user_id,email) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,version={self.table('account_email')}.version+1,verified=0",
            (user_id, email),
        )

    def _fresh(self, db, user):
        row = self.execute(
            db,
            f"SELECT * FROM {self.table('approved_accounts')} WHERE id=? AND active=1 AND version=?",
            (user["id"], user["version"]),
        ).fetchone()
        if row is None:
            raise HTTPException(401, "Your account changed. Sign in again.")
        return dict(row)

    def begin(self, user):
        with self.accounts.connect() as db:
            user = self._fresh(db, user)
            contact = self.factor(db, user["id"])
            if not contact:
                raise HTTPException(
                    409,
                    "No security email is registered. Ask the operator to assign your approved email address.",
                )
            contact = dict(contact)
        security_mail.ensure_ready(contact["email"])
        self.limits.take("email-code-cooldown", user["id"], maximum=1, seconds=60)
        self.limits.take("email-codes-hour", user["id"], maximum=10, seconds=3600)
        token = secrets.token_urlsafe(32)
        token_hash = _digest(token)
        code = f"{secrets.randbelow(1000000):06d}"
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self._fresh(db, user)
            fresh = self.factor(db, user["id"])
            if not fresh or fresh["version"] != contact["version"]:
                raise HTTPException(401, "Your email changed. Sign in again.")
            self.execute(
                db,
                f"DELETE FROM {self.table('email_challenges')} WHERE expires_at<=? OR user_id=?",
                (now_seconds(), user["id"]),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('email_challenges')} (id,user_id,account_version,email_version,code_hash,expires_at) VALUES (?,?,?,?,?,?)",
                (
                    token_hash,
                    user["id"],
                    user["version"],
                    contact["version"],
                    _code_hash(token_hash, code),
                    now_seconds() + CHALLENGE_SECONDS,
                ),
            )
        try:
            security_mail.send_code(contact["email"], code, token_hash)
        except BaseException:
            with self.accounts.connect() as db:
                self.execute(
                    db, f"DELETE FROM {self.table('email_challenges')} WHERE id=?", (token_hash,)
                )
            raise
        return {
            "mfa_required": True,
            "challenge_id": token,
            "destination": masked_email(contact["email"]),
            "expires_in": CHALLENGE_SECONDS,
            "resend_after": 60,
        }

    def challenge_user(self, token):
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT user_id FROM {self.table('email_challenges')} WHERE id=?",
                (_digest(token),),
            ).fetchone()
        return row["user_id"] if row else None

    def resend(self, token):
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT u.* FROM {self.table('email_challenges')} c JOIN {self.table('approved_accounts')} u ON u.id=c.user_id JOIN {self.table('account_email')} e ON e.user_id=u.id WHERE c.id=? AND c.expires_at>? AND c.account_version=u.version AND c.email_version=e.version AND c.attempts<? AND u.active=1",
                (_digest(token), now_seconds(), MAX_ATTEMPTS),
            ).fetchone()
        if not row:
            raise HTTPException(401, "This verification has expired. Sign in again.")
        return self.begin(dict(row))

    def verify(self, token, code):
        token_hash = _digest(token)
        error, result = None, None
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            challenge = self.execute(
                db, f"SELECT * FROM {self.table('email_challenges')} WHERE id=?", (token_hash,)
            ).fetchone()
            if (
                not challenge
                or challenge["expires_at"] <= now_seconds()
                or challenge["attempts"] >= MAX_ATTEMPTS
            ):
                error = "This verification has expired. Sign in again."
            else:
                user = self.execute(
                    db,
                    f"SELECT u.* FROM {self.table('approved_accounts')} u JOIN {self.table('account_email')} e ON e.user_id=u.id WHERE u.id=? AND u.active=1 AND u.version=? AND e.version=?",
                    (
                        challenge["user_id"],
                        challenge["account_version"],
                        challenge["email_version"],
                    ),
                ).fetchone()
                if user is None:
                    error = "Your account changed. Sign in again."
                elif not re.fullmatch(r"[0-9]{6}", code) or not hmac.compare_digest(
                    _code_hash(token_hash, code), challenge["code_hash"]
                ):
                    self.execute(
                        db,
                        f"UPDATE {self.table('email_challenges')} SET attempts=attempts+1 WHERE id=?",
                        (token_hash,),
                    )
                    error = "That security code is incorrect. Check the most recent email and try again."
                else:
                    self.execute(
                        db,
                        f"UPDATE {self.table('account_email')} SET verified=1 WHERE user_id=?",
                        (user["id"],),
                    )
                    self.execute(
                        db,
                        f"DELETE FROM {self.table('email_challenges')} WHERE user_id=?",
                        (user["id"],),
                    )
                    self.accounts._event(db, user["id"], user["id"], "email_code_verified")
                    result = dict(user)
        if error:
            raise HTTPException(401, error)
        return result, []

    def set_by_operator(self, user_id, email=None):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            if not self.execute(
                db, f"SELECT 1 FROM {self.table('approved_accounts')} WHERE id=?", (user_id,)
            ).fetchone():
                raise ValueError("The approved account does not exist.")
            if email:
                self.assign_email(db, user_id, email)
            else:
                self.execute(
                    db,
                    f"UPDATE {self.table('account_email')} SET version=version+1,verified=0 WHERE user_id=?",
                    (user_id,),
                )
            self.execute(
                db, f"DELETE FROM {self.table('email_challenges')} WHERE user_id=?", (user_id,)
            )
            self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET version=version+1 WHERE id=?",
                (user_id,),
            )
            self.accounts._event(
                db,
                "operator",
                user_id,
                "security_email_changed" if email else "email_verification_reset",
            )

    def reset_by_operator(self, user_id):
        self.set_by_operator(user_id)
