"""Single-machine persistence. No invoice data or local file paths in the public repo."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .contracts import InvoiceSummary, SavedInvoice


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        self.files = self.directory / "files"
        self.files.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / "invoices.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY, filename TEXT NOT NULL, document_hash TEXT NOT NULL,
                status TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, error TEXT, price_sheet_version TEXT NOT NULL,
                document TEXT, invoice TEXT, check_result TEXT
            )""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS invoice_time ON invoices(created_at DESC, id DESC)"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def recover(self):
        # One uvicorn worker only. Completed rows are never reprocessed on startup.
        with self.connect() as db:
            db.execute(
                """UPDATE invoices SET status='failed', error=?, updated_at=?
                WHERE status NOT IN ('completed', 'failed')""",
                ("Processing was interrupted by a service restart; upload again to retry", now()),
            )

    def path(self, invoice_id: str):
        return self.files / f"{invoice_id}.pdf"

    def insert(self, invoice_id, filename, document_hash, mode, price_sheet_version):
        at = now()
        with self.connect() as db:
            db.execute(
                """INSERT INTO invoices
                (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version)
                VALUES (?,?,?,'reading',?,?,?,?)""",
                (invoice_id, filename, document_hash, mode, at, at, price_sheet_version),
            )

    def update(self, invoice_id, status, *, document=None, invoice=None, check=None, error=None):
        with self.connect() as db:
            db.execute(
                """UPDATE invoices SET status=?, updated_at=?, error=?,
                document=COALESCE(?, document), invoice=COALESCE(?, invoice),
                check_result=COALESCE(?, check_result) WHERE id=?""",
                (
                    status,
                    now(),
                    error,
                    document.model_dump_json() if document is not None else None,
                    invoice.model_dump_json() if invoice is not None else None,
                    check.model_dump_json() if check is not None else None,
                    invoice_id,
                ),
            )

    def get(self, invoice_id: str) -> SavedInvoice | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["check"] = data.pop("check_result")
        for key in ("document", "invoice", "check"):
            data[key] = json.loads(data[key]) if data[key] else None
        return SavedInvoice(**data, file_url=f"/invoices/{invoice_id}/file")

    def list(self, limit: int, offset: int) -> list[InvoiceSummary]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id,filename,document_hash,status,mode,created_at,
                updated_at,error,price_sheet_version FROM invoices
                ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
        return [InvoiceSummary(**dict(row)) for row in rows]
