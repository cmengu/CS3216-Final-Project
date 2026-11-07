"""Shared capacity and workspace turns; the database is the authority across replicas."""

import logging
import math
import os
import threading
from uuid import uuid4

from fastapi import HTTPException

from .access_store import AccessStore

log = logging.getLogger(__name__)


def seconds(name, default):
    value = float(os.environ.get(name, str(default)))
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and positive")
    return value


def count(name, default):
    value = int(os.environ.get(name, str(default)))
    if value < 1:
        raise ValueError(f"{name} must be a positive whole number")
    return value


def busy(detail="The service is at capacity. Waiting files can retry shortly."):
    return HTTPException(503, detail, headers={"Retry-After": "5"})


class Fleet(AccessStore):
    def __init__(self, store):
        super().__init__(store)
        self.processing_limit = count("INVOICE_FLEET_PROCESSING", 1)
        self.upload_limit = count("INVOICE_FLEET_UPLOADS", 1)
        self.workspace_limit = count("INVOICE_WORKSPACE_PROCESSING", 1)
        self.quantum = count("INVOICE_TURN_INVOICES", 20)
        self.turn_seconds = seconds("INVOICE_TURN_SECONDS", 60)
        self.processing_seconds = seconds("INVOICE_PROCESSING_TIMEOUT_SECONDS", 900)
        self.upload_seconds = seconds("INVOICE_UPLOAD_TIMEOUT_SECONDS", 120)
        self.backlog_limit = count("INVOICE_FLEET_PENDING", 1500)
        self.workspace_pending = count("INVOICE_WORKSPACE_PENDING", 500)
        self.enabled = True
        self.configuration_errors = []
        # Limits live in one shared row, so differently configured replicas cannot
        # silently enforce different fleet sizes during a rolling deployment.
        with self.connect() as db:
            # Migrate defaults introduced by the first local policy revision.
            # Existing acknowledged jobs are retained, even if above a new cap.
            revision = self.execute(
                db,
                f"INSERT INTO {self.table('fleet_settings')} AS policy (name,value) VALUES ('capacity-policy-version',3) ON CONFLICT(name) DO UPDATE SET value=3 WHERE policy.value<3 RETURNING value",
            ).fetchone()
            if revision is not None:
                for name, environment, old, new in (
                    ("pending", "INVOICE_FLEET_PENDING", 10000, 1500),
                    ("workspace-pending", "INVOICE_WORKSPACE_PENDING", 2000, 500),
                ):
                    if environment not in os.environ:
                        self.execute(
                            db,
                            f"UPDATE {self.table('fleet_settings')} SET value=? WHERE name=? AND value=?",
                            (new, name, old),
                        )
                if (
                    "INVOICE_FLEET_STORAGE_LIMIT_MB" not in os.environ
                    and getattr(store, "source_budget_default_mb", 1024) != 1024
                ):
                    self.execute(
                        db,
                        f"UPDATE {self.table('fleet_settings')} SET value=? WHERE name='storage-mb' AND value=1024",
                        (store.source_budget_default_mb,),
                    )
            for name, limit in (
                ("processing", self.processing_limit),
                ("upload", self.upload_limit),
                ("workspace-processing", self.workspace_limit),
                ("pending", self.backlog_limit),
                ("workspace-pending", self.workspace_pending),
                ("turn-invoices", self.quantum),
                ("turn-seconds", math.ceil(self.turn_seconds)),
                ("processing-seconds", math.ceil(self.processing_seconds)),
                ("upload-seconds", math.ceil(self.upload_seconds)),
                (
                    "storage-mb",
                    count(
                        "INVOICE_FLEET_STORAGE_LIMIT_MB",
                        getattr(store, "source_budget_default_mb", 1024),
                    ),
                ),
                ("database-budget-mb", getattr(store, "database_budget_bytes", 0) // (1024 * 1024)),
            ):
                self.execute(
                    db,
                    f"INSERT INTO {self.table('fleet_settings')} (name,value) VALUES (?,?) ON CONFLICT(name) DO NOTHING",
                    (name, limit),
                )
                stored = self.execute(
                    db, f"SELECT value FROM {self.table('fleet_settings')} WHERE name=?", (name,)
                ).fetchone()["value"]
                if stored != limit:
                    self.enabled = False
                    self.configuration_errors.append(name)
        if not self.enabled:
            log.error(
                "Invoice admission/processing paused: shared settings differ (%s)",
                ", ".join(self.configuration_errors),
            )

    def require_enabled(self):
        if not self.enabled:
            raise busy(
                "Processing settings need administrator attention. Saved invoices remain available."
            )

    def clock(self, db):
        query = (
            "SELECT CAST(EXTRACT(EPOCH FROM clock_timestamp()) AS BIGINT) AS at"
            if self.schema
            else "SELECT CAST(strftime('%s','now') AS INTEGER) AS at"
        )
        return self.execute(db, query).fetchone()["at"]

    def lock(self, db):
        self.execute(
            db,
            f"UPDATE {self.table('fleet_scheduler')} SET ticket=ticket WHERE id='main'",
        )

    def active(self, db, kind, at, workspace=None):
        scope, params = "", [kind, at, at]
        if workspace is not None:
            scope = " AND workspace_id=?"
            params.append(workspace)
        return self.execute(
            db,
            f"SELECT COUNT(*) AS n FROM {self.table('fleet_leases')} "
            f"WHERE kind=? AND (lease_until>? OR safe_until>?){scope}",
            tuple(params),
        ).fetchone()["n"]

    def reserve(self, db, kind, workspace, owner, lease_id, duration):
        at = self.clock(db)
        maximum = self.upload_limit if kind == "upload" else self.processing_limit
        if self.active(db, kind, at) >= maximum:
            return False
        if kind == "processing" and self.active(db, kind, at, workspace) >= self.workspace_limit:
            return False
        self.execute(
            db,
            f"INSERT INTO {self.table('fleet_leases')} "
            "(id,kind,workspace_id,owner,lease_until,safe_until) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,safe_until=excluded.safe_until",
            (lease_id, kind, workspace, owner, at + 90, at + math.ceil(duration) + 10),
        )
        return True

    def acquire(self, kind, workspace, *, requested=None):
        self.require_enabled()
        owner, lease_id = str(uuid4()), str(uuid4())
        duration = self.upload_seconds if kind == "upload" else self.processing_seconds
        with self.connect() as db:
            self.lock(db)
            if kind == "upload" and requested is not None:
                self.admit(db, workspace, requested)
            if not self.reserve(db, kind, workspace, owner, lease_id, duration):
                raise busy()
        lease = FleetLease(self, lease_id, owner)
        lease.start()
        return lease

    def ensure(self, db, lease_id, owner):
        at = self.clock(db)
        row = self.execute(
            db,
            f"UPDATE {self.table('fleet_leases')} SET lease_until=lease_until WHERE id=? AND owner=? AND lease_until>? AND safe_until>? RETURNING id",
            (lease_id, owner, at, at),
        ).fetchone()
        if row is None:
            raise busy("This upload no longer owns its capacity reservation. Retry the upload.")

    def renew(self, lease_id, owner):
        with self.connect() as db:
            at = self.clock(db)
            return (
                self.execute(
                    db,
                    f"UPDATE {self.table('fleet_leases')} SET lease_until=? WHERE id=? AND owner=? AND lease_until>? AND safe_until>?",
                    (at + 90, lease_id, owner, at, at),
                ).rowcount
                == 1
            )

    def remaining(self, lease_id, owner):
        with self.connect() as db:
            self.ensure(db, lease_id, owner)
            row = self.execute(
                db,
                f"SELECT safe_until FROM {self.table('fleet_leases')} WHERE id=? AND owner=?",
                (lease_id, owner),
            ).fetchone()
            return max(0.001, row["safe_until"] - self.clock(db) - 10)

    def release(self, lease_id, owner, *, db=None):
        if db is None:
            with self.connect() as connection:
                return self.release(lease_id, owner, db=connection)
        self.execute(
            db,
            f"DELETE FROM {self.table('fleet_leases')} WHERE id=? AND owner=?",
            (lease_id, owner),
        )

    def quarantine(self, lease_id, owner):
        with self.connect() as db:
            self.execute(
                db,
                f"UPDATE {self.table('fleet_leases')} SET safe_until=9223372036854775807 WHERE id=? AND owner=?",
                (lease_id, owner),
            )

    def queue_space(self, db, workspace):
        self.require_enabled()
        table = self.table("invoice_jobs")
        total = self.execute(
            db, f"SELECT COUNT(*) AS n FROM {table} WHERE status IN ('queued','running')"
        ).fetchone()["n"]
        own = self.execute(
            db,
            f"SELECT COUNT(*) AS n FROM {table} WHERE status IN ('queued','running') AND workspace_id=?",
            (workspace,),
        ).fetchone()["n"]
        return max(0, min(self.backlog_limit - total, self.workspace_pending - own))

    def admit(self, db, workspace, added):
        self.require_enabled()
        if not added:
            return
        remaining = self.queue_space(db, workspace)
        if added > remaining:
            raise HTTPException(
                503,
                "There is not enough free queue space for this batch. Waiting files can retry shortly.",
                headers={"Retry-After": "30", "X-Invoice-Batch-Limit": str(remaining)},
            )


class FleetLease:
    def __init__(self, fleet, lease_id, owner):
        self.fleet, self.id, self.owner = fleet, lease_id, owner
        self.stopped, self.lost = threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self._renew, daemon=True, name="fleet-lease")

    def start(self):
        self.thread.start()

    def _renew(self):
        while not self.stopped.wait(20):
            try:
                if self.fleet.renew(self.id, self.owner):
                    continue
            except Exception:
                log.warning("Shared capacity renewal unavailable")
            self.lost.set()
            return

    def close(self, *, release=True):
        self.stopped.set()
        self.thread.join(timeout=1)
        try:
            if release:
                self.fleet.release(self.id, self.owner)
            else:
                self.fleet.quarantine(self.id, self.owner)
        except Exception:
            # Keep the reservation until its safe recovery deadline on DB failure.
            log.warning("Shared capacity release deferred until safe recovery")
