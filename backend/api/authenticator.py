"""Password-bound TOTP enrollment/login, encrypted secrets and one-use recovery codes."""

import base64
import hashlib
import hmac
import io
import os
import re
import secrets
import time

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from qrcode.image.svg import SvgPathImage

CHALLENGE_SECONDS = 300
MAX_ATTEMPTS = 5


def now_seconds():
    return int(time.time())


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def keyed_digest(purpose, value):
    key = (os.environ.get("AUTH_MFA_KEY") or os.environ.get("AUTH_SECRET") or "").strip()
    if len(key) < 32:
        raise HTTPException(503, "The operator must restore the persistent authentication key.")
    return hmac.new(key.encode(), (purpose + ":" + value).encode(), hashlib.sha256).digest()


def cipher():
    return Fernet(base64.urlsafe_b64encode(keyed_digest("authenticator-encryption:v1", "key")))


def decrypt(value, user_id):
    try:
        # Bind ciphertext to the owner so swapping rows cannot swap authenticators.
        owner, secret = cipher().decrypt(value.encode()).decode().split(":", 1)
        if owner != user_id:
            raise ValueError("Wrong owner")
        return secret
    except (InvalidToken, ValueError, UnicodeError):
        raise HTTPException(
            503, "Authenticator data could not be opened. Contact the operator."
        ) from None


def recovery_hash(user_id, code):
    normalized = code.upper().replace("-", "").replace(" ", "")
    return keyed_digest("authenticator-recovery:v1", user_id + ":" + normalized).hex()


class Authenticator:
    def __init__(self, email_factor):
        self.email_factor = email_factor
        self.accounts = email_factor.accounts
        self.table, self.execute = self.accounts.table, self.accounts.execute
        with self.accounts.connect() as db:
            for name, columns in {
                "authenticator_factors": """user_id TEXT PRIMARY KEY, secret TEXT NOT NULL,
                    last_counter BIGINT NOT NULL DEFAULT -1""",
                "authenticator_challenges": """id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    account_version BIGINT NOT NULL, email_version BIGINT NOT NULL,
                    kind TEXT NOT NULL, secret TEXT, expires_at BIGINT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0""",
                "authenticator_recovery": """user_id TEXT NOT NULL, code_hash TEXT NOT NULL,
                    PRIMARY KEY(user_id,code_hash)""",
                "authenticator_sessions": "id TEXT PRIMARY KEY",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")

    def factor(self, db, user_id):
        return self.execute(
            db, f"SELECT * FROM {self.table('authenticator_factors')} WHERE user_id=?", (user_id,)
        ).fetchone()

    def enrolled(self, user_id):
        with self.accounts.connect() as db:
            return self.factor(db, user_id) is not None

    def begin(self, user, *, enroll=False):
        self.email_factor.limits.take("authenticator-start", user["id"], maximum=15, seconds=600)
        token, secret = secrets.token_urlsafe(32), pyotp.random_base32() if enroll else None
        encrypted = (
            cipher().encrypt((user["id"] + ":" + secret).encode()).decode() if secret else None
        )
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            user = self.email_factor._fresh(db, user)
            contact = self.email_factor.factor(db, user["id"])
            factor = self.factor(db, user["id"])
            if not contact or not contact["verified"]:
                raise HTTPException(401, "Verify your registered email before authenticator setup.")
            if enroll == bool(factor):
                raise HTTPException(401, "Your authenticator changed. Sign in again.")
            self.execute(
                db,
                f"DELETE FROM {self.table('authenticator_challenges')} WHERE expires_at<=? OR user_id=?",
                (now_seconds(), user["id"]),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('authenticator_challenges')} (id,user_id,account_version,email_version,kind,secret,expires_at) VALUES (?,?,?,?,?,?,?)",
                (
                    digest(token),
                    user["id"],
                    user["version"],
                    contact["version"],
                    "setup" if enroll else "login",
                    encrypted,
                    now_seconds() + CHALLENGE_SECONDS,
                ),
            )
        result = {
            "mfa_required": True,
            "method": "totp_setup" if enroll else "totp",
            "challenge_id": token,
            "expires_in": CHALLENGE_SECONDS,
            "destination": "your authenticator app",
            "resend_after": 0,
        }
        if secret:
            uri = pyotp.TOTP(secret).provisioning_uri(
                name=user["username"], issuer_name="Invoice Checker"
            )
            output = io.BytesIO()
            qrcode.make(uri, image_factory=SvgPathImage).save(output)
            result.update(
                {
                    "secret": secret,
                    "qr_code": "data:image/svg+xml;base64,"
                    + base64.b64encode(output.getvalue()).decode(),
                }
            )
        return result

    def challenge_user(self, token):
        with self.accounts.connect() as db:
            row = self.execute(
                db,
                f"SELECT user_id FROM {self.table('authenticator_challenges')} WHERE id=?",
                (digest(token),),
            ).fetchone()
        return row["user_id"] if row else None

    def verify(self, token, code):
        error, result, codes = None, None, []
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            challenge = self.execute(
                db,
                f"SELECT * FROM {self.table('authenticator_challenges')} WHERE id=?",
                (digest(token),),
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
                factor = self.factor(db, challenge["user_id"])
                setup = challenge["kind"] == "setup"
                if not user or setup == bool(factor):
                    error = "Your account changed. Sign in again."
                else:
                    secret = decrypt(challenge["secret"] if setup else factor["secret"], user["id"])
                    counter = self._counter(secret, code, -1 if setup else factor["last_counter"])
                    recovered = False
                    if not setup and counter is None:
                        recovered = (
                            self.execute(
                                db,
                                f"DELETE FROM {self.table('authenticator_recovery')} WHERE user_id=? AND code_hash=?",
                                (user["id"], recovery_hash(user["id"], code)),
                            ).rowcount
                            == 1
                        )
                    if counter is None and not recovered:
                        self.execute(
                            db,
                            f"UPDATE {self.table('authenticator_challenges')} SET attempts=attempts+1 WHERE id=?",
                            (digest(token),),
                        )
                        error = "That code is incorrect or was already used. Try the current authenticator code."
                    else:
                        if setup:
                            self.execute(
                                db,
                                f"INSERT INTO {self.table('authenticator_factors')} (user_id,secret,last_counter) VALUES (?,?,?)",
                                (user["id"], challenge["secret"], counter),
                            )
                            codes = [
                                "-".join(re.findall(".{5}", secrets.token_hex(10).upper()))
                                for _ in range(10)
                            ]
                            for recovery in codes:
                                self.execute(
                                    db,
                                    f"INSERT INTO {self.table('authenticator_recovery')} (user_id,code_hash) VALUES (?,?)",
                                    (user["id"], recovery_hash(user["id"], recovery)),
                                )
                        elif counter is not None:
                            self.execute(
                                db,
                                f"UPDATE {self.table('authenticator_factors')} SET last_counter=? WHERE user_id=?",
                                (counter, user["id"]),
                            )
                        self.execute(
                            db,
                            f"DELETE FROM {self.table('authenticator_challenges')} WHERE user_id=?",
                            (user["id"],),
                        )
                        self.accounts._event(
                            db,
                            user["id"],
                            user["id"],
                            "authenticator_enrolled"
                            if setup
                            else "authenticator_recovery_used"
                            if recovered
                            else "authenticator_verified",
                        )
                        result = dict(user)
        if error:
            raise HTTPException(401, error)
        return result, codes

    @staticmethod
    def _counter(secret, code, last_counter):
        if not re.fullmatch(r"[0-9]{6}", code):
            return None
        totp = pyotp.TOTP(secret)
        current = now_seconds() // 30
        for counter in (current, current - 1, current + 1):
            if counter > last_counter and hmac.compare_digest(totp.generate_otp(counter), code):
                return counter
        return None

    def reset_by_operator(self, user_id):
        with self.accounts.connect() as db:
            self.accounts._lock(db)
            if not self.execute(
                db, f"SELECT 1 FROM {self.table('approved_accounts')} WHERE id=?", (user_id,)
            ).fetchone():
                raise ValueError("The approved account does not exist.")
            for name in (
                "authenticator_factors",
                "authenticator_challenges",
                "authenticator_recovery",
                "email_challenges",
            ):
                self.execute(db, f"DELETE FROM {self.table(name)} WHERE user_id=?", (user_id,))
            self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET version=version+1 WHERE id=?",
                (user_id,),
            )
            self.accounts._event(db, "operator", user_id, "authenticator_reset_by_operator")
