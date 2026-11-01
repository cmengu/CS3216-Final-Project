"""Email-proven password recovery, bound to the current account and registered inbox."""

import hmac
import secrets

from fastapi import HTTPException

from . import security_mail
from .mfa import CHALLENGE_SECONDS, MAX_ATTEMPTS, _code_hash, _digest, masked_email, now_seconds
from .passwords import hash_password


class PasswordReset:
    def __init__(self, accounts):
        self.accounts = accounts
        self.table, self.execute = accounts.table, accounts.execute
        with accounts.connect() as db:
            identity = "user_id TEXT NOT NULL, account_version BIGINT NOT NULL, email_version BIGINT NOT NULL"
            for name, columns in {
                "password_reset_codes": f"""id TEXT PRIMARY KEY, {identity},
                    code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0""",
                "password_reset_grants": f"""id TEXT PRIMARY KEY, {identity},
                    expires_at BIGINT NOT NULL""",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")

    def _fresh(self, db, proof):
        row = self.execute(
            db,
            f"""SELECT u.id,u.username,u.version,e.email,e.version AS email_version
                FROM {self.table("approved_accounts")} u
                JOIN {self.table("account_email")} e ON e.user_id=u.id
                WHERE u.id=? AND u.active=1 AND u.version=? AND e.version=?""",
            (proof["user_id"], proof["account_version"], proof["email_version"]),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Your account changed. Start password reset again.")
        return row

    def start(self, email):
        email = security_mail.normalize_email(email)
        limits = self.accounts.mfa.limits
        limits.take("password-reset-cooldown", email, maximum=1, seconds=60)
        limits.take("password-reset-emails-hour", email, maximum=10, seconds=3600)
        token = secrets.token_urlsafe(32)
        challenge = {
            "mfa_required": True,
            "challenge_id": token,
            "destination": masked_email(email),
            "expires_in": CHALLENGE_SECONDS,
            "resend_after": 60,
        }
        with self.accounts.connect() as db:
            user = self.execute(
                db,
                f"""SELECT u.id AS user_id,u.version AS account_version,e.version AS email_version
                    FROM {self.table("approved_accounts")} u
                    JOIN {self.table("account_email")} e ON e.user_id=u.id
                    WHERE u.active=1 AND e.email=?""",
                (email,),
            ).fetchone()
        # Do not disclose whether this inbox has an active account, or create an account.
        if not user:
            return challenge
        security_mail.ensure_ready(email)
        token_hash, code = _digest(token), f"{secrets.randbelow(1000000):06d}"
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            self._fresh(db, user)
            self.execute(
                db,
                f"DELETE FROM {self.table('password_reset_codes')} WHERE user_id=? OR expires_at<=?",
                (user["user_id"], now_seconds()),
            )
            self.execute(
                db,
                f"DELETE FROM {self.table('password_reset_grants')} WHERE expires_at<=?",
                (now_seconds(),),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('password_reset_codes')} (id,user_id,account_version,email_version,code_hash,expires_at) VALUES (?,?,?,?,?,?)",
                (
                    token_hash,
                    user["user_id"],
                    user["account_version"],
                    user["email_version"],
                    _code_hash("password-reset:" + token_hash, code),
                    now_seconds() + CHALLENGE_SECONDS,
                ),
            )
        try:
            security_mail.send_code(email, code, token_hash)
        except BaseException:
            with self.accounts.connect() as db:
                self.execute(
                    db,
                    f"DELETE FROM {self.table('password_reset_codes')} WHERE id=?",
                    (token_hash,),
                )
            raise
        return challenge

    def resend(self, token):
        with self.accounts.connect() as db:
            proof = self.execute(
                db,
                f"SELECT * FROM {self.table('password_reset_codes')} WHERE id=? AND expires_at>? AND attempts<?",
                (_digest(token), now_seconds(), MAX_ATTEMPTS),
            ).fetchone()
            if not proof:
                raise HTTPException(
                    401, "This verification has expired. Start password reset again."
                )
            email = self._fresh(db, proof)["email"]
        return self.start(email)

    def verify(self, token, code):
        token_hash = _digest(token)
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT user_id FROM {self.table('password_reset_codes')} WHERE id=?",
                (token_hash,),
            ).fetchone()
        if row:
            self.accounts.mfa.limits.take(
                "password-reset-verify", row["user_id"], maximum=15, seconds=600
            )
        error, grant = None, None
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            row = self.execute(
                db, f"SELECT * FROM {self.table('password_reset_codes')} WHERE id=?", (token_hash,)
            ).fetchone()
            if not row or row["expires_at"] <= now_seconds() or row["attempts"] >= MAX_ATTEMPTS:
                error = "This verification has expired. Start password reset again."
            else:
                self._fresh(db, row)
                if not hmac.compare_digest(
                    _code_hash("password-reset:" + token_hash, code), row["code_hash"]
                ):
                    self.execute(
                        db,
                        f"UPDATE {self.table('password_reset_codes')} SET attempts=attempts+1 WHERE id=?",
                        (token_hash,),
                    )
                    error = "That security code is incorrect. Check the most recent email."
                else:
                    grant = secrets.token_urlsafe(32)
                    self.execute(
                        db,
                        f"DELETE FROM {self.table('password_reset_codes')} WHERE id=?",
                        (token_hash,),
                    )
                    self.execute(
                        db,
                        f"INSERT INTO {self.table('password_reset_grants')} (id,user_id,account_version,email_version,expires_at) VALUES (?,?,?,?,?)",
                        (
                            _digest(grant),
                            row["user_id"],
                            row["account_version"],
                            row["email_version"],
                            now_seconds() + CHALLENGE_SECONDS,
                        ),
                    )
        if error:
            raise HTTPException(401, error)
        return {"reset_grant": grant, "expires_in": CHALLENGE_SECONDS}

    def _grant(self, db, token):
        proof = self.execute(
            db,
            f"SELECT * FROM {self.table('password_reset_grants')} WHERE id=? AND expires_at>?",
            (_digest(token), now_seconds()),
        ).fetchone()
        if not proof:
            raise HTTPException(401, "Email verification has expired. Start password reset again.")
        return self._fresh(db, proof)

    def complete(self, token, password):
        with self.accounts.connect() as db:
            self._grant(db, token)
        password_hash = hash_password(password)
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            user = self._grant(db, token)
            self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET password_hash=?,version=version+1 WHERE id=?",
                (password_hash, user["id"]),
            )
            self.execute(
                db,
                f"DELETE FROM {self.table('email_verified_sessions')} WHERE id IN (SELECT id FROM {self.table('account_sessions')} WHERE user_id=?)",
                (user["id"],),
            )
            self.execute(
                db,
                f"DELETE FROM {self.table('authenticator_sessions')} WHERE id IN (SELECT id FROM {self.table('account_sessions')} WHERE user_id=?)",
                (user["id"],),
            )
            for name in (
                "account_sessions",
                "authenticator_challenges",
                "email_challenges",
                "password_reset_codes",
                "password_reset_grants",
            ):
                self.execute(db, f"DELETE FROM {self.table(name)} WHERE user_id=?", (user["id"],))
            self.accounts._event(db, user["id"], user["id"], "password_reset_by_email")
        return {"ok": True}
