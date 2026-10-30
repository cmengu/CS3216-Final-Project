"""Durable, leased invoice jobs; no browser session or in-memory queue is required."""

import json
import logging
import threading
import time
from uuid import uuid4

from .access_store import AccessStore
from .processing import LostLease, process_stored_invoice
from .storage import now
from .uploaded_master import UploadedMasterStages

log = logging.getLogger(__name__)
LEASE_SECONDS = 90
MAX_ATTEMPTS = 3


class InvoiceJobs(AccessStore):
    def existing(self, workspace, document_hash):
        with self.connect() as db:
            row = self.execute(
                db,
                f"SELECT id FROM {self.table('invoices')} WHERE session_id=? AND document_hash=? AND status!='failed' ORDER BY created_at DESC LIMIT 1",
                (workspace, document_hash),
            ).fetchone()
        return row["id"] if row else None

    def enqueue(self, workspace, documents, master_version):
        batch_id = str(uuid4())
        accepted, duplicates = [], []
        with self.connect() as db:
            # Serializes inserts for one workspace, including duplicate detection.
            self.execute(
                db,
                f"UPDATE {self.table('storage_limits')} SET reserved=reserved WHERE workspace_id=?",
                (workspace,),
            )
            self.execute(
                db,
                f"INSERT INTO {self.table('invoice_batches')} (id,workspace_id,created_at) VALUES (?,?,?)",
                (batch_id, workspace, now()),
            )
            for item in documents:
                duplicate = self.execute(
                    db,
                    f"SELECT id FROM {self.table('invoices')} WHERE session_id=? AND document_hash=? AND status!='failed' ORDER BY created_at DESC LIMIT 1",
                    (workspace, item["document_hash"]),
                ).fetchone()
                if duplicate:
                    duplicates.append({**item, "existing_id": duplicate["id"]})
                    continue
                at = now()
                self.execute(
                    db,
                    f"INSERT INTO {self.table('invoices')} (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version,session_id) VALUES (?,?,?,'queued',?,?,?,?,?)",
                    (
                        item["id"],
                        item["filename"],
                        item["document_hash"],
                        item["mode"],
                        at,
                        at,
                        master_version,
                        workspace,
                    ),
                )
                if self.schema:
                    self.execute(
                        db,
                        f"INSERT INTO {self.table('invoice_files')} (id,content) VALUES (?,?)",
                        (item["id"], self.store.path(item["id"]).read_bytes()),
                    )
                self.execute(
                    db,
                    f"INSERT INTO {self.table('invoice_jobs')} (invoice_id,batch_id,workspace_id,status,master_version,created_at) VALUES (?,?,?,'queued',?,?)",
                    (item["id"], batch_id, workspace, master_version, at),
                )
                accepted.append(item["id"])
        return batch_id, accepted, duplicates

    def batch(self, batch_id, workspace):
        with self.connect() as db:
            exists = self.execute(
                db,
                f"SELECT id FROM {self.table('invoice_batches')} WHERE id=? AND workspace_id=?",
                (batch_id, workspace),
            ).fetchone()
            if not exists:
                return None
            rows = self.execute(
                db,
                f"SELECT i.id,i.status FROM {self.table('invoices')} i JOIN {self.table('invoice_jobs')} j ON i.id=j.invoice_id WHERE j.batch_id=? AND j.workspace_id=? ORDER BY j.created_at,i.id",
                (batch_id, workspace),
            ).fetchall()
        statuses = [row["status"] for row in rows]
        return {
            "id": batch_id,
            "invoice_ids": [row["id"] for row in rows],
            "total": len(rows),
            "completed": statuses.count("completed"),
            "failed": statuses.count("failed"),
            "queued": statuses.count("queued"),
            "processing": sum(
                status not in {"queued", "completed", "failed"} for status in statuses
            ),
        }

    def ready(self):
        with self.connect() as db:
            return (
                self.execute(
                    db,
                    f"SELECT 1 FROM {self.table('invoice_jobs')} WHERE status='queued' OR (status='running' AND lease_until<=?) LIMIT 1",
                    (int(time.time()),),
                ).fetchone()
                is not None
            )

    def claim(self, owner):
        at = int(time.time())
        table = self.table("invoice_jobs")
        with self.connect() as db:
            exhausted = self.execute(
                db,
                f"SELECT invoice_id FROM {table} WHERE status='running' AND lease_until<=? AND attempts>=?",
                (at, MAX_ATTEMPTS),
            ).fetchall()
            for row in exhausted:
                changed = self.execute(
                    db,
                    f"UPDATE {table} SET status='done',owner=NULL WHERE invoice_id=? AND lease_until<=? AND status='running'",
                    (row["invoice_id"], at),
                ).rowcount
                if changed:
                    self.execute(
                        db,
                        f"UPDATE {self.table('invoices')} SET status='failed',error=?,updated_at=? WHERE id=?",
                        (
                            "reading: Processing was interrupted repeatedly. Upload again to retry.",
                            now(),
                            row["invoice_id"],
                        ),
                    )
            row = self.execute(
                db,
                f"""UPDATE {table} SET status='running',owner=?,lease_until=?,attempts=attempts+1
                WHERE invoice_id=(SELECT invoice_id FROM {table} WHERE (status='queued' OR (status='running' AND lease_until<=?)) AND attempts<? ORDER BY created_at,invoice_id LIMIT 1)
                AND (status='queued' OR (status='running' AND lease_until<=?))
                RETURNING invoice_id,workspace_id,master_version""",
                (owner, at + LEASE_SECONDS, at, MAX_ATTEMPTS, at),
            ).fetchone()
        return dict(row) if row else None

    def heartbeat(self, invoice_id, owner):
        with self.connect() as db:
            return (
                self.execute(
                    db,
                    f"UPDATE {self.table('invoice_jobs')} SET lease_until=? WHERE invoice_id=? AND owner=? AND status='running' AND lease_until>?",
                    (int(time.time()) + LEASE_SECONDS, invoice_id, owner, int(time.time())),
                ).rowcount
                == 1
            )

    def save(self, invoice_id, owner, status, **values):
        names = {
            "document": "document",
            "invoice": "invoice",
            "check": "check_result",
            "error": "error",
        }
        assignments, parameters = ["status=?", "updated_at=?"], [status, now()]
        for key, value in values.items():
            if key not in names:
                raise ValueError("Invalid queued invoice field")
            if key != "error":
                value = json.dumps(value.model_dump(mode="json"))
            cast = "::jsonb" if self.schema and key != "error" else ""
            assignments.append(names[key] + "=?" + cast)
            parameters.append(value)
        with self.connect() as db:
            # This write locks the lease row until the result write commits. Stale workers
            # cannot overwrite results from a restarted/replacement worker.
            owns = self.execute(
                db,
                f"UPDATE {self.table('invoice_jobs')} SET lease_until=lease_until WHERE invoice_id=? AND owner=? AND status='running' AND lease_until>?",
                (invoice_id, owner, int(time.time())),
            ).rowcount
            if not owns:
                raise LostLease()
            self.execute(
                db,
                f"UPDATE {self.table('invoices')} SET {','.join(assignments)} WHERE id=?",
                (*parameters, invoice_id),
            )
            if status in {"completed", "failed"}:
                self.execute(
                    db,
                    f"UPDATE {self.table('invoice_jobs')} SET status='done',owner=NULL,lease_until=0 WHERE invoice_id=? AND owner=?",
                    (invoice_id, owner),
                )


class InvoiceWorker:
    def __init__(self, app):
        self.app = app
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.owner = str(uuid4())
        self.thread = threading.Thread(target=self.run, daemon=True, name="invoice-worker")

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake.set()
        self.thread.join(timeout=3)

    def run(self):
        while not self.stop_event.is_set():
            job = None
            try:
                ready = self.app.state.jobs.ready()
            except Exception:
                ready = False
            if not ready or self.app.state.stages is None:
                self.wake.wait(1)
                self.wake.clear()
                continue
            if not self.app.state.slot.acquire(timeout=0.2):
                continue
            try:
                job = self.app.state.jobs.claim(self.owner)
                if job:
                    self.process(job)
            except Exception as exc:
                log.warning("Invoice queue worker failed (%s)", type(exc).__name__)
            finally:
                self.app.state.slot.release()
            if not job:
                self.wake.wait(1)
                self.wake.clear()

    def process(self, job):
        jobs = self.app.state.jobs
        invoice_id, workspace = job["invoice_id"], job["workspace_id"]
        done = threading.Event()

        def renew():
            while not done.wait(20):
                try:
                    if not jobs.heartbeat(invoice_id, self.owner):
                        break
                except Exception:
                    break

        heartbeat = threading.Thread(target=renew, daemon=True, name="invoice-lease")
        heartbeat.start()

        def save(status, **values):
            return jobs.save(invoice_id, self.owner, status, **values)

        try:
            saved = self.app.state.store.get(invoice_id, session_id=workspace)
            if saved is None:
                save("failed", error="reading: The queued invoice is unavailable.")
                return
            selected = self.app.state.stages
            if isinstance(selected, UploadedMasterStages):
                selected = selected.bind(
                    self.app.state.store, session_id=workspace, version=job["master_version"]
                )
            if selected is None or selected.price_sheet_version != job["master_version"]:
                save(
                    "failed",
                    error="checking: The original master list is unavailable. Upload again to retry.",
                )
                return
            save("reading")
            process_stored_invoice(
                self.app.state.store.path(invoice_id),
                saved.filename,
                saved.document_hash,
                selected,
                self.app.state.reader,
                save,
            )
        except LostLease:
            pass
        except Exception as exc:
            try:
                save(
                    "failed",
                    error=f"reading: {type(exc).__name__}: queued processing failed; upload again to retry",
                )
            except LostLease:
                pass
        finally:
            done.set()
            heartbeat.join(timeout=1)
