"""Encrypted TOTP enrollment, expiring password-bound challenges and one-use recovery."""

import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import time

import pyotp
import segno
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

CHALLENGE_SECONDS = 300
MAX_ATTEMPTS = 5


def now_seconds():
    return int(time.time())


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _cipher():
    secret = (os.environ.get("AUTH_MFA_KEY") or os.environ.get("AUTH_SECRET") or "").strip()
    if len(secret) < 32:
        raise ValueError("Keep AUTH_MFA_KEY or AUTH_SECRET configured with at least 32 characters.")
    key = hashlib.sha256(b"invoice-checker:totp:v1\0" + secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def recovery_hash(user_id, code):
    normalized = re.sub(r"[\s-]", "", code).upper()
    return _digest("recovery:" + user_id + ":" + normalized)


class TwoFactor:
    def __init__(self, accounts):
        self.accounts = accounts
        self.table = accounts.table
        self.execute = accounts.execute
        with accounts.connect() as db:
            for name, columns in {
                "account_mfa": """user_id TEXT PRIMARY KEY, secret TEXT NOT NULL,
                    last_counter BIGINT NOT NULL, recovery TEXT NOT NULL""",
                "mfa_challenges": """id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    version BIGINT NOT NULL, kind TEXT NOT NULL, secret TEXT,
                    expires_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0""",
                "mfa_verified_sessions": "id TEXT PRIMARY KEY",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")
            self.execute(
                db,
                f"CREATE INDEX IF NOT EXISTS mfa_challenge_expiry ON {self.table('mfa_challenges')}(expires_at)",
            )

    def required(self, user):
        return True

    def factor(self, db, user_id):
        return self.execute(
            db, f"SELECT * FROM {self.table('account_mfa')} WHERE user_id=?", (user_id,)
        ).fetchone()

    def needs_verification(self, user):
        with self.accounts.connect() as db:
            return self.required(user) or self.factor(db, user["id"]) is not None

    def _fresh(self, db, user):
        row = self.execute(
            db,
            f"SELECT * FROM {self.table('approved_accounts')} WHERE id=? AND active=1 AND version=?",
            (user["id"], user["version"]),
        ).fetchone()
        if row is None:
            raise HTTPException(401, "Your account changed. Sign in again.")
        return dict(row)

    def _new_challenge(self, db, user, kind, secret=None):
        token = secrets.token_urlsafe(32)
        self.execute(
            db, f"DELETE FROM {self.table('mfa_challenges')} WHERE expires_at<=?", (now_seconds(),)
        )
        self.execute(
            db,
            f"INSERT INTO {self.table('mfa_challenges')} (id,user_id,version,kind,secret,expires_at) VALUES (?,?,?,?,?,?)",
            (
                _digest(token),
                user["id"],
                user["version"],
                kind,
                _cipher().encrypt(secret.encode()).decode() if secret else None,
                now_seconds() + CHALLENGE_SECONDS,
            ),
        )
        result = {
            "mfa_required": True,
            "challenge_id": token,
            "enrollment": None,
            "expires_in": CHALLENGE_SECONDS,
        }
        if secret:
            uri = pyotp.TOTP(secret).provisioning_uri(
                name=user["username"], issuer_name="Invoice Checker"
            )
            image = io.BytesIO()
            segno.make(uri, micro=False).save(image, kind="png", scale=5, border=4)
            result["enrollment"] = {
                "secret": secret,
                "qr_code": "data:image/png;base64," + base64.b64encode(image.getvalue()).decode(),
            }
        return result

    def begin(self, user):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            user = self._fresh(db, user)
            enrolled = self.factor(db, user["id"]) is not None
            return self._new_challenge(
                db,
                user,
                "verify" if enrolled else "enroll",
                None if enrolled else pyotp.random_base32(),
            )

    def _counter(self, encrypted, code, last=-1):
        if not re.fullmatch(r"[0-9]{6}", code):
            return None
        try:
            otp = pyotp.TOTP(_cipher().decrypt(encrypted.encode()).decode())
        except InvalidToken:
            return None
        now = now_seconds() // 30
        for counter in (now, now - 1, now + 1):
            if counter > last and hmac.compare_digest(otp.generate_otp(counter), code):
                return counter
        return None

    def _consume_factor(self, db, factor, user_id, code):
        codes = json.loads(factor["recovery"])
        supplied = recovery_hash(user_id, code)
        matched = next((value for value in codes if hmac.compare_digest(value, supplied)), None)
        if matched:
            codes.remove(matched)
            self.execute(
                db,
                f"UPDATE {self.table('account_mfa')} SET recovery=? WHERE user_id=?",
                (json.dumps(codes), user_id),
            )
            self.accounts._event(db, user_id, user_id, "mfa_recovery_used")
            return True
        counter = self._counter(factor["secret"], code, factor["last_counter"])
        if counter is None:
            return False
        self.execute(
            db,
            f"UPDATE {self.table('account_mfa')} SET last_counter=? WHERE user_id=?",
            (counter, user_id),
        )
        return True

    def verify(self, token, code):
        error, result, recovery = None, None, []
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            challenge = self.execute(
                db, f"SELECT * FROM {self.table('mfa_challenges')} WHERE id=?", (_digest(token),)
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
                    f"SELECT * FROM {self.table('approved_accounts')} WHERE id=? AND active=1 AND version=?",
                    (challenge["user_id"], challenge["version"]),
                ).fetchone()
                if user is None:
                    error = "Your account changed. Sign in again."
                else:
                    factor = self.factor(db, user["id"])
                    counter = (
                        self._counter(challenge["secret"], code) if challenge["secret"] else None
                    )
                    valid = (
                        factor is not None and self._consume_factor(db, factor, user["id"], code)
                        if challenge["kind"] == "verify"
                        else counter is not None
                        and (factor is None or challenge["kind"] == "replace")
                    )
                    if not valid:
                        self.execute(
                            db,
                            f"UPDATE {self.table('mfa_challenges')} SET attempts=attempts+1 WHERE id=?",
                            (_digest(token),),
                        )
                        error = "That code is invalid or already used. Try a fresh code from your authenticator."
                    else:
                        if challenge["kind"] != "verify":
                            recovery = [
                                "-".join([value[i : i + 5] for i in range(0, 20, 5)])
                                for value in (secrets.token_hex(10).upper() for _ in range(10))
                            ]
                            self.execute(
                                db,
                                f"INSERT INTO {self.table('account_mfa')} (user_id,secret,last_counter,recovery) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,last_counter=excluded.last_counter,recovery=excluded.recovery",
                                (
                                    user["id"],
                                    challenge["secret"],
                                    counter,
                                    json.dumps(
                                        [recovery_hash(user["id"], value) for value in recovery]
                                    ),
                                ),
                            )
                            self.execute(
                                db,
                                f"UPDATE {self.table('approved_accounts')} SET version=version+1 WHERE id=?",
                                (user["id"],),
                            )
                            self.accounts._event(
                                db,
                                user["id"],
                                user["id"],
                                "mfa_enrolled" if challenge["kind"] == "enroll" else "mfa_replaced",
                            )
                        self.execute(
                            db,
                            f"DELETE FROM {self.table('mfa_challenges')} WHERE user_id=?",
                            (user["id"],),
                        )
                        result = dict(
                            self.execute(
                                db,
                                f"SELECT * FROM {self.table('approved_accounts')} WHERE id=?",
                                (user["id"],),
                            ).fetchone()
                        )
        # Failed attempts must commit before returning an error.
        if error:
            raise HTTPException(401, error)
        return result, recovery

    def challenge_user(self, token):
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT user_id FROM {self.table('mfa_challenges')} WHERE id=?",
                (_digest(token),),
            ).fetchone()
        return row["user_id"] if row else None

    def replace(self, user, password, code):
        from .passwords import verify_password

        if not verify_password(password, user["password_hash"]):
            raise HTTPException(401, "Your current password is incorrect.")
        result = None
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            user = self._fresh(db, user)
            factor = self.factor(db, user["id"])
            if factor and self._consume_factor(db, factor, user["id"], code):
                result = self._new_challenge(db, user, "replace", pyotp.random_base32())
        if result is None:
            raise HTTPException(401, "Enter a fresh authenticator code or an unused recovery code.")
        return result

    def reset_by_operator(self, user_id):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            if not self.execute(
                db, f"SELECT 1 FROM {self.table('approved_accounts')} WHERE id=?", (user_id,)
            ).fetchone():
                raise ValueError("The approved account does not exist.")
            self.execute(db, f"DELETE FROM {self.table('account_mfa')} WHERE user_id=?", (user_id,))
            self.execute(
                db, f"DELETE FROM {self.table('mfa_challenges')} WHERE user_id=?", (user_id,)
            )
            self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET version=version+1 WHERE id=?",
                (user_id,),
            )
            self.accounts._event(db, "operator", user_id, "mfa_reset_operator")
