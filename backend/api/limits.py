"""Database-backed rate limits and capacity reservations for expensive operations."""

import hashlib
import math
import os
import time
from contextlib import nullcontext

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

    def take(self, scope, identity, *, maximum, seconds, amount=1):
        self.take_many([(scope, identity, maximum, seconds, amount)])

    def take_many(self, requests, *, db=None):
        """Commit every allowance together; rejected requests consume none."""
        requests = [request for request in requests if request[4] != 0]
        for _scope, _identity, maximum, seconds, amount in requests:
            if amount < 0 or amount > maximum:
                raise HTTPException(
                    429,
                    "This batch exceeds the available checking allowance. Submit a smaller batch.",
                    headers={"Retry-After": str(seconds), "X-Invoice-Batch-Limit": str(maximum)},
                )
        if not requests:
            return
        at = int(time.time())
        table = self.table("request_limits")
        with self.connect() if db is None else nullcontext(db) as connection:
            self.execute(connection, f"DELETE FROM {table} WHERE reset_at <= ?", (at,))
            for scope, identity, maximum, seconds, amount in requests:
                key = hashlib.sha256(f"{scope}:{identity}".encode()).hexdigest()
                row = self.execute(
                    connection,
                    f"""INSERT INTO {table} AS limits (key, reset_at, used)
                    VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET used=limits.used+excluded.used
                    WHERE limits.used+excluded.used <= ? RETURNING reset_at, used""",
                    (key, at + seconds, amount, maximum),
                ).fetchone()
                if row is None:
                    current = self.execute(
                        connection, f"SELECT reset_at,used FROM {table} WHERE key=?", (key,)
                    ).fetchone()
                    retry = max(1, math.ceil(current["reset_at"] - time.time()))
                    raise HTTPException(
                        429,
                        "Too many requests. Please wait and try again.",
                        headers={
                            "Retry-After": str(retry),
                            "X-Invoice-Batch-Limit": str(max(0, maximum - current["used"])),
                        },
                    )

    def lock_storage(self, workspace, db):
        """Initialize and lock one workspace before deduplication and admission."""
        self._lock_global_storage(db)
        table = self.table("storage_limits")
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
                    db, f"SELECT id FROM {self.table('invoices')} WHERE session_id=?", (workspace,)
                ).fetchall()
                invoices = 0
                for row in ids:
                    try:
                        invoices += self.store.path(row["id"]).stat().st_size
                    except FileNotFoundError:
                        pass
            self.execute(
                db,
                f"INSERT INTO {table} (workspace_id,reserved) VALUES (?,?) ON CONFLICT(workspace_id) DO NOTHING",
                (workspace, masters + invoices),
            )
        self.execute(db, f"UPDATE {table} SET reserved=reserved WHERE workspace_id=?", (workspace,))

    def reserve_invoices(self, workspace, total, pdfs, size, *, db=None, locked=False):
        with self.connect() if db is None else nullcontext(db) as connection:
            if not locked:
                self.lock_storage(workspace, connection)
            self.take_many(invoice_allowances(workspace, total, pdfs), db=connection)
            self.reserve_storage(
                workspace,
                size,
                maximum=self.storage_maximum(),
                db=connection,
                locked=True,
            )

    def storage_maximum(self):
        return (
            allowance(
                "INVOICE_STORAGE_LIMIT_MB", getattr(self.store, "source_budget_default_mb", 1024)
            )
            * 1024
            * 1024
        )

    def reserve_storage(self, workspace, size, *, maximum, db=None, locked=False):
        if size < 0:
            raise ValueError("Storage reservation cannot be negative")
        with self.connect() if db is None else nullcontext(db) as connection:
            if not locked:
                self.lock_storage(workspace, connection)
            if size == 0:
                return
            global_maximum = (
                allowance(
                    "INVOICE_FLEET_STORAGE_LIMIT_MB",
                    getattr(self.store, "source_budget_default_mb", 1024),
                )
                * 1024
                * 1024
            )
            if hasattr(self.store, "check_growth"):
                self.store.check_growth(connection, size)
            global_row = self.execute(
                connection,
                f"UPDATE {self.table('fleet_storage')} SET reserved=reserved+? WHERE id='main' AND reserved+?<=? RETURNING reserved",
                (size, size, global_maximum),
            ).fetchone()
            if global_row is None:
                raise HTTPException(
                    413,
                    "The service has reached its shared storage allowance. Contact your administrator.",
                )
            row = self.execute(
                connection,
                f"UPDATE {self.table('storage_limits')} SET reserved=reserved+? WHERE workspace_id=? AND reserved+?<=? RETURNING reserved",
                (size, workspace, size, maximum),
            ).fetchone()
            if row is None:
                raise HTTPException(
                    413,
                    "This workspace has reached its storage allowance. Contact your administrator.",
                )

    def release_storage(self, workspace: str, size: int) -> None:
        if size < 0:
            raise ValueError("Storage release cannot be negative")
        table = self.table("storage_limits")
        with self.connect() as db:
            self._lock_global_storage(db)
            current = self.execute(
                db, f"SELECT reserved FROM {table} WHERE workspace_id=?", (workspace,)
            ).fetchone()
            released = min(size, current["reserved"]) if current else 0
            self.execute(
                db,
                f"UPDATE {self.table('fleet_storage')} SET reserved=CASE WHEN reserved>? THEN reserved-? ELSE 0 END WHERE id='main'",
                (released, released),
            )
            self.execute(
                db,
                f"UPDATE {table} SET reserved=CASE WHEN reserved>? THEN reserved-? ELSE 0 END WHERE workspace_id=?",
                (size, size, workspace),
            )

    def _lock_global_storage(self, db):
        table = self.table("fleet_storage")
        row = self.execute(db, f"SELECT reserved FROM {table} WHERE id='main'").fetchone()
        if row is None:
            masters = self.execute(
                db,
                f"SELECT COALESCE(SUM(length(source)),0) AS bytes FROM {self.table('master_lists')}",
            ).fetchone()["bytes"]
            if self.schema:
                invoices = self.execute(
                    db,
                    f"SELECT COALESCE(SUM(octet_length(content)),0) AS bytes FROM {self.table('invoice_files')}",
                ).fetchone()["bytes"]
            else:
                invoices = 0
                for item in self.execute(db, "SELECT id FROM invoices").fetchall():
                    try:
                        invoices += self.store.path(item["id"]).stat().st_size
                    except FileNotFoundError:
                        pass
            self.execute(
                db,
                f"INSERT INTO {table} (id,reserved) VALUES ('main',?) ON CONFLICT(id) DO NOTHING",
                (masters + invoices,),
            )
        self.execute(db, f"UPDATE {table} SET reserved=reserved WHERE id='main'")


def allowance(name, default):
    try:
        value = int(os.environ.get(name, str(default)))
        if value < 1:
            raise ValueError()
        return value
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive whole number") from exc


def invoice_allowances(workspace, total, pdfs):
    requests = []
    for name, scope, seconds, amount in (
        ("INVOICE_CHECKS_PER_HOUR", "checks-hour", 3600, total),
        ("INVOICE_CHECKS_PER_DAY", "checks-day", 86400, total),
        ("INVOICE_AI_CHECKS_PER_DAY", "model-checks-day", 86400, pdfs),
    ):
        raw = os.environ.get(name, "0").strip()
        try:
            maximum = int(raw or "0")
            if maximum < 0:
                raise ValueError()
        except ValueError as exc:
            raise ValueError(
                f"{name} must be a non-negative whole number; zero disables this optional quota"
            ) from exc
        if maximum:
            requests.append((scope, workspace, maximum, seconds, amount))
    return requests


def charge_checks(request, total, pdfs):
    from .storage import request_session_id

    request.app.state.limits.take_many(invoice_allowances(request_session_id(request), total, pdfs))


def reserve_upload(request, size):
    from .storage import request_session_id

    request.app.state.limits.reserve_storage(
        request_session_id(request),
        size,
        maximum=request.app.state.limits.storage_maximum(),
    )
    return size
