"""Database-backed rate limits and capacity reservations for expensive operations."""

import hashlib
import math
import os
import time

from fastapi import HTTPException

from .access_store import AccessStore


class UsageLimits(AccessStore):
    def __init__(self, store):
        super().__init__(store)
        with self.connect() as db:
            self.execute(
                db,
                f"""CREATE TABLE IF NOT EXISTS {self.table("request_limits")} (
                key TEXT PRIMARY KEY, reset_at BIGINT NOT NULL, used BIGINT NOT NULL
            )""",
            )
            self.execute(
                db,
                f"""CREATE TABLE IF NOT EXISTS {self.table("storage_limits")} (
                workspace_id TEXT PRIMARY KEY, reserved BIGINT NOT NULL DEFAULT 0
            )""",
            )
            self.execute(
                db,
                f"CREATE INDEX IF NOT EXISTS request_limit_expiry ON {self.table('request_limits')}(reset_at)",
            )

    def take(
        self, scope: str, identity: str, *, maximum: int, seconds: int, amount: int = 1
    ) -> None:
        if amount == 0:
            return
        if amount < 0 or amount > maximum:
            raise HTTPException(
                429,
                "This batch exceeds the available checking allowance. Submit a smaller batch.",
                headers={"Retry-After": str(seconds)},
            )
        # Store opaque identifiers rather than raw IP addresses or usernames.
        key = hashlib.sha256(f"{scope}:{identity}".encode()).hexdigest()
        at = int(time.time())
        table = self.table("request_limits")
        with self.connect() as db:
            self.execute(db, f"DELETE FROM {table} WHERE reset_at <= ?", (at,))
            row = self.execute(
                db,
                f"""INSERT INTO {table} AS limits (key, reset_at, used)
                VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET used=limits.used+excluded.used
                WHERE limits.used+excluded.used <= ? RETURNING reset_at, used""",
                (key, at + seconds, amount, maximum),
            ).fetchone()
            if row is None:
                row = self.execute(
                    db, f"SELECT reset_at FROM {table} WHERE key=?", (key,)
                ).fetchone()
                retry = max(1, math.ceil(row["reset_at"] - time.time()))
            else:
                retry = None
        if retry is not None:
            raise HTTPException(
                429,
                "Too many requests. Please wait and try again.",
                headers={"Retry-After": str(retry)},
            )

    def reserve_storage(self, workspace: str, size: int, *, maximum: int) -> None:
        if size < 0:
            raise ValueError("Storage reservation cannot be negative")
        table = self.table("storage_limits")
        with self.connect() as db:
            present = self.execute(
                db, f"SELECT reserved FROM {table} WHERE workspace_id=?", (workspace,)
            ).fetchone()
            if present is None:
                masters = self.execute(
                    db,
                    f"SELECT COALESCE(SUM(length(source)),0) AS bytes FROM {self.table('master_lists')} WHERE session_id=?",
                    (workspace,),
                ).fetchone()["bytes"]
                if self.schema:
                    invoices = self.execute(
                        db,
                        f"SELECT COALESCE(SUM(octet_length(f.content)),0) AS bytes FROM {self.table('invoice_files')} f JOIN {self.table('invoices')} i ON i.id=f.id WHERE i.session_id=?",
                        (workspace,),
                    ).fetchone()["bytes"]
                else:
                    ids = self.execute(
                        db,
                        f"SELECT id FROM {self.table('invoices')} WHERE session_id=?",
                        (workspace,),
                    ).fetchall()
                    invoices = sum(
                        self.store.path(row["id"]).stat().st_size
                        for row in ids
                        if self.store.path(row["id"]).is_file()
                    )
                self.execute(
                    db,
                    f"INSERT INTO {table} (workspace_id,reserved) VALUES (?,?) ON CONFLICT(workspace_id) DO NOTHING",
                    (workspace, masters + invoices),
                )
            row = self.execute(
                db,
                f"UPDATE {table} SET reserved=reserved+? WHERE workspace_id=? AND reserved+?<=? RETURNING reserved",
                (size, workspace, size, maximum),
            ).fetchone()
        if row is None:
            raise HTTPException(
                413, "This workspace has reached its storage allowance. Contact your administrator."
            )

    def release_storage(self, workspace: str, size: int) -> None:
        if size < 0:
            raise ValueError("Storage release cannot be negative")
        table = self.table("storage_limits")
        with self.connect() as db:
            self.execute(
                db,
                f"UPDATE {table} SET reserved=CASE WHEN reserved>? THEN reserved-? ELSE 0 END WHERE workspace_id=?",
                (size, size, workspace),
            )


def allowance(name, default):
    try:
        value = int(os.environ.get(name, str(default)))
        if value < 1:
            raise ValueError()
        return value
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive whole number") from exc


def charge_checks(request, total, pdfs):
    from .storage import request_session_id

    limits, workspace = request.app.state.limits, request_session_id(request)
    limits.take(
        "checks-hour",
        workspace,
        maximum=allowance("INVOICE_CHECKS_PER_HOUR", 1000),
        seconds=3600,
        amount=total,
    )
    limits.take(
        "checks-day",
        workspace,
        maximum=allowance("INVOICE_CHECKS_PER_DAY", 2000),
        seconds=86400,
        amount=total,
    )
    limits.take(
        "model-checks-day",
        workspace,
        maximum=allowance("INVOICE_AI_CHECKS_PER_DAY", 200),
        seconds=86400,
        amount=pdfs,
    )


def reserve_upload(request, size):
    from .storage import request_session_id

    request.app.state.limits.reserve_storage(
        request_session_id(request),
        size,
        maximum=allowance("INVOICE_STORAGE_LIMIT_MB", 1024) * 1024 * 1024,
    )
    return size
