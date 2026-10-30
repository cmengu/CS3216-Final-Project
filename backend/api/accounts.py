"""Administrator-approved accounts and registered, revocable login sessions."""

import hashlib
import hmac
import os
import re
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException

from .access_store import AccessStore
from .passwords import hash_password, verify_password

_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

USERNAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.@+-]{1,79}\Z")


def clean_username(value):
    cleaned = str(value or "").strip().lower()
    if not USERNAME.fullmatch(cleaned):
        raise ValueError("Use 2 to 80 letters, numbers, or . _ @ + - for the username.")
    return cleaned


def public_user(row):
    return {
        **{key: row[key] for key in ("id", "username", "role", "created_at")},
        "active": bool(row["active"]),
    }


class Accounts(AccessStore):
    def __init__(self, store):
        super().__init__(store)
        with self.connect() as db:
            for name, columns in {
                "account_control": "id TEXT PRIMARY KEY, version INTEGER NOT NULL",
                "approved_accounts": """id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL,
                    workspace_id TEXT NOT NULL, version INTEGER NOT NULL, created_at BIGINT NOT NULL""",
                "account_sessions": """id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    version INTEGER NOT NULL, expires_at BIGINT NOT NULL""",
                "account_events": """id TEXT PRIMARY KEY, actor TEXT NOT NULL,
                    target TEXT NOT NULL, action TEXT NOT NULL, created_at BIGINT NOT NULL""",
            }.items():
                self.execute(db, f"CREATE TABLE IF NOT EXISTS {self.table(name)} ({columns})")
            self.execute(
                db,
                f"INSERT INTO {self.table('account_control')} (id,version) VALUES ('accounts',0) ON CONFLICT(id) DO NOTHING",
            )
            self.execute(
                db,
                f"CREATE INDEX IF NOT EXISTS account_session_expiry ON {self.table('account_sessions')}(expires_at)",
            )
        # Hash once, so unknown and disabled accounts perform the same password work as real ones.
        self.dummy_password = _DUMMY_PASSWORD_HASH

    def _lock(self, db):
        self.execute(
            db, f"UPDATE {self.table('account_control')} SET version=version+1 WHERE id='accounts'"
        )

    def _check_admin(self, db, actor, session_id=None):
        if actor is None:
            return  # Trusted operator/bootstrap calls have no HTTP actor.
        params = [actor]
        query = f"SELECT 1 FROM {self.table('approved_accounts')} a WHERE a.id=? AND a.active=1 AND a.role='admin'"
        if session_id is not None:
            query += f" AND EXISTS (SELECT 1 FROM {self.table('account_sessions')} s WHERE s.id=? AND s.user_id=a.id AND s.version=a.version AND s.expires_at>?) AND NOT EXISTS (SELECT 1 FROM {self.table('revoked_sessions')} r WHERE r.session_id=? AND r.expires_at>?)"
            params += [session_id, int(time.time()), session_id, int(time.time())]
        if self.execute(db, query, tuple(params)).fetchone() is None:
            raise HTTPException(403, "Administrator access changed. Sign in again.")

    def end_session(self, session_id):
        with self.connect() as db:
            self._lock(db)
            self.execute(
                db, f"DELETE FROM {self.table('account_sessions')} WHERE id=?", (session_id,)
            )

    def _event(self, db, actor, target, action):
        self.execute(
            db,
            f"INSERT INTO {self.table('account_events')} (id,actor,target,action,created_at) VALUES (?,?,?,?,?)",
            (str(uuid4()), actor, target, action, int(time.time())),
        )

    def _insert(self, db, username, password_hash, role, workspace, actor):
        if self.execute(
            db, f"SELECT id FROM {self.table('approved_accounts')} WHERE username=?", (username,)
        ).fetchone():
            raise HTTPException(409, "That username already exists.")
        user_id = str(uuid4())
        self.execute(
            db,
            f"INSERT INTO {self.table('approved_accounts')} (id,username,password_hash,role,active,workspace_id,version,created_at) VALUES (?,?,?,?,1,?,1,?)",
            (user_id, username, password_hash, role, user_id, int(time.time())),
        )
        self._event(db, actor or user_id, user_id, "account_created")
        return user_id

    def has_accounts(self):
        with self.connect() as db:
            return (
                self.execute(
                    db, f"SELECT 1 FROM {self.table('approved_accounts')} LIMIT 1"
                ).fetchone()
                is not None
            )

    def bootstrap_configured_admin(self):
        if self.has_accounts():
            return
        username = os.environ.get("AUTH_USERNAME", "").strip()
        password = os.environ.get("AUTH_PASSWORD", "")
        if username and password:
            if username.lower() == "demo-account" or password == "invoice-checker":
                raise ValueError(
                    "Default demo credentials are not allowed. Prepare a one-time admin setup link."
                )
            username = clean_username(username)
            password_hash = hash_password(password)
            with self.connect() as db:
                self._lock(db)
                if not self.execute(
                    db, f"SELECT 1 FROM {self.table('approved_accounts')} LIMIT 1"
                ).fetchone():
                    self._insert(db, username, password_hash, "admin", None, None)

    def setup(self, token, username, password):
        configured = os.environ.get("AUTH_SETUP_TOKEN", "")
        if len(configured) < 32 or not hmac.compare_digest(
            hashlib.sha256(str(token).encode()).digest(),
            hashlib.sha256(configured.encode()).digest(),
        ):
            raise HTTPException(
                403, "The setup link is invalid. Ask the operator for a new setup link."
            )
        username = clean_username(username)
        password_hash = hash_password(password)
        with self.connect() as db:
            self._lock(db)
            if self.execute(
                db, f"SELECT 1 FROM {self.table('approved_accounts')} LIMIT 1"
            ).fetchone():
                raise HTTPException(
                    409, "Administrator setup is already complete. Sign in instead."
                )
            user_id = self._insert(db, username, password_hash, "admin", "company", None)
        return self.get_user(user_id)

    def create_user(self, username, password, role, actor=None, actor_session=None):
        username = clean_username(username)
        if role not in {"admin", "member"}:
            raise ValueError("Choose Admin or Member.")
        password_hash = hash_password(password)
        with self.connect() as db:
            self._lock(db)
            self._check_admin(db, actor, actor_session)
            user_id = self._insert(db, username, password_hash, role, None, actor)
        return self.get_user(user_id)

    def get_user(self, user_id):
        with self.connect() as db:
            row = self.execute(
                db, f"SELECT * FROM {self.table('approved_accounts')} WHERE id=?", (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def authenticate(self, username, password):
        with self.connect() as db:
            row = self.execute(
                db,
                f"SELECT * FROM {self.table('approved_accounts')} WHERE username=?",
                (str(username).strip().lower(),),
            ).fetchone()
        valid = verify_password(password, row["password_hash"] if row else self.dummy_password)
        return dict(row) if valid and row and row["active"] else None

    def create_session(self, user, ttl):
        sid, expires = str(uuid4()), int(time.time()) + ttl
        with self.connect() as db:
            self.execute(
                db,
                f"DELETE FROM {self.table('account_sessions')} WHERE expires_at<=?",
                (int(time.time()),),
            )
            # The account may have been disabled/reset while its password was being verified.
            fresh = self.execute(
                db,
                f"SELECT version,active FROM {self.table('approved_accounts')} WHERE id=?",
                (user["id"],),
            ).fetchone()
            if not fresh or not fresh["active"] or fresh["version"] != user["version"]:
                raise HTTPException(401, "Your account has changed. Sign in again.")
            self.execute(
                db,
                f"INSERT INTO {self.table('account_sessions')} (id,user_id,version,expires_at) VALUES (?,?,?,?)",
                (sid, user["id"], user["version"], expires),
            )
        return sid, expires

    def session_claims(self, sid, username, expires):
        with self.connect() as db:
            row = self.execute(
                db,
                f"""SELECT a.id,a.username,a.role,a.workspace_id FROM {self.table("account_sessions")} s
                JOIN {self.table("approved_accounts")} a ON a.id=s.user_id
                WHERE s.id=? AND a.username=? AND a.active=1 AND a.version=s.version
                AND s.expires_at>=? AND s.expires_at>?""",
                (sid, username, expires, int(time.time())),
            ).fetchone()
        return (
            {"user_id": row["id"], "workspace_id": row["workspace_id"], "role": row["role"]}
            if row
            else None
        )

    def list_users(self):
        with self.connect() as db:
            return [
                public_user(row)
                for row in self.execute(
                    db, f"SELECT * FROM {self.table('approved_accounts')} ORDER BY created_at,id"
                ).fetchall()
            ]

    def update_user(
        self, target, *, actor, actor_session=None, active=None, role=None, password=None
    ):
        if target == actor:
            raise HTTPException(
                409,
                "Use Change password for your own account. Another administrator must change your access.",
            )
        if role is not None and role not in {"admin", "member"}:
            raise ValueError("Choose Admin or Member.")
        password_hash = hash_password(password) if password is not None else None
        with self.connect() as db:
            self._lock(db)
            self._check_admin(db, actor, actor_session)
            row = self.execute(
                db, f"SELECT * FROM {self.table('approved_accounts')} WHERE id=?", (target,)
            ).fetchone()
            if not row:
                raise HTTPException(404, "Account not found.")
            updated_active = int(active) if active is not None else row["active"]
            updated_role = role if role is not None else row["role"]
            if (
                row["active"]
                and row["role"] == "admin"
                and (not updated_active or updated_role != "admin")
            ):
                others = self.execute(
                    db,
                    f"SELECT COUNT(*) AS n FROM {self.table('approved_accounts')} WHERE active=1 AND role='admin'",
                ).fetchone()["n"]
                if others <= 1:
                    raise HTTPException(409, "Keep at least one active administrator.")
            self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET active=?,role=?,password_hash=?,version=version+1 WHERE id=?",
                (updated_active, updated_role, password_hash or row["password_hash"], target),
            )
            self._event(
                db, actor, target, "password_reset" if password_hash else "account_access_changed"
            )
        return public_user(self.get_user(target))

    def change_password(self, user_id, current, new):
        user = self.get_user(user_id)
        if not user or not user["active"] or not verify_password(current, user["password_hash"]):
            raise HTTPException(401, "Your current password is incorrect.")
        password_hash = hash_password(new)
        with self.connect() as db:
            self._lock(db)
            changed = self.execute(
                db,
                f"UPDATE {self.table('approved_accounts')} SET password_hash=?,version=version+1 WHERE id=? AND version=? AND active=1",
                (password_hash, user_id, user["version"]),
            ).rowcount
            if changed != 1:
                raise HTTPException(409, "Your account changed. Sign in again.")
            self._event(db, user_id, user_id, "password_changed")
