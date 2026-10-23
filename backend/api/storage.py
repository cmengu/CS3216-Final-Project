"""Persistence. SQLite on one machine by default; Postgres when DATABASE_URL is set.

Both stores keep the same three things: the invoices with their JSON stages, the uploaded PDFs,
and the master-list versions. No invoice data or local file paths in the public repo.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .contracts import InvoiceSummary, SavedInvoice

INTERRUPTED = "Processing was interrupted by a service restart; upload again to retry"
# The AP clerk's decision. Added after the first release, so older databases gain the columns.
OUTCOME_COLUMNS = ("outcome", "outcome_reason", "decided_at")
SUMMARY = (
    "id,filename,document_hash,status,mode,created_at,updated_at,error,price_sheet_version,"
    + ",".join(OUTCOME_COLUMNS)
)


def now():
    return datetime.now(timezone.utc).isoformat()


def open_store(directory: Path):
    """Postgres when DATABASE_URL is set (Supabase in production), else SQLite in `directory`."""
    url = os.environ.get("DATABASE_URL", "").strip()
    return PostgresStore(url, directory) if url else Store(directory)


class MasterListExists(Exception):
    """An initial upload was attempted when a master list is already saved."""


class NoMasterList(Exception):
    """A replacement was attempted before any master list was saved."""


def _saved(row: dict, invoice_id: str) -> SavedInvoice:
    data = dict(row)
    data["check"] = data.pop("check_result")
    for key in ("document", "invoice", "check"):
        value = data[key]
        data[key] = json.loads(value) if isinstance(value, str) else value
    return SavedInvoice(**data, file_url=f"/invoices/{invoice_id}/file")


def _loaded(value):
    return json.loads(value) if isinstance(value, str) else value


class Store:
    """SQLite in one directory. One uvicorn worker only."""

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
                document TEXT, invoice TEXT, check_result TEXT,
                outcome TEXT, outcome_reason TEXT, decided_at TEXT
            )""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS invoice_time ON invoices(created_at DESC, id DESC)"
            )
            present = {row["name"] for row in db.execute("PRAGMA table_info(invoices)")}
            for column in OUTCOME_COLUMNS:
                if column not in present:
                    db.execute(f"ALTER TABLE invoices ADD COLUMN {column} TEXT")
            db.execute("""CREATE TABLE IF NOT EXISTS master_lists (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL,
                event TEXT NOT NULL, source BLOB NOT NULL
            )""")

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
        # Completed rows are never reprocessed on startup.
        with self.connect() as db:
            db.execute(
                """UPDATE invoices SET status='failed', error=?, updated_at=?
                WHERE status NOT IN ('completed', 'failed')""",
                (INTERRUPTED, now()),
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

    def decide(self, invoice_id: str, outcome: str | None, reason: str | None):
        """Save or clear the outcome. The decision time is the service's clock, never the caller's."""
        with self.connect() as db:
            db.execute(
                "UPDATE invoices SET outcome=?, outcome_reason=?, decided_at=? WHERE id=?",
                (outcome, reason, now() if outcome else None, invoice_id),
            )

    def get(self, invoice_id: str) -> SavedInvoice | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
        return None if row is None else _saved(dict(row), invoice_id)

    def list(self, limit: int, offset: int) -> list[InvoiceSummary]:
        with self.connect() as db:
            rows = db.execute(
                f"""SELECT {SUMMARY} FROM invoices
                ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
        return [InvoiceSummary(**dict(row)) for row in rows]

    def latest_master_list(self) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT document FROM master_lists ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
        return _loaded(row["document"]) if row else None

    def master_list_events(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT event FROM master_lists ORDER BY rowid DESC").fetchall()
        return [_loaded(row["event"]) for row in rows]

    def add_master_list(self, document: dict, event: dict, source: bytes, *, replace: bool):
        """Save one version. The first upload must find none; a replacement must find one."""
        with self.connect() as db:
            # One transaction serialises replacements and keeps the version order.
            db.execute("BEGIN IMMEDIATE")
            exists = db.execute("SELECT 1 FROM master_lists LIMIT 1").fetchone() is not None
            _check_state(exists, replace)
            db.execute(
                "INSERT INTO master_lists VALUES (?,?,?,?,?)",
                (
                    document["id"],
                    document["uploadedAt"],
                    json.dumps(document),
                    json.dumps(event),
                    source,
                ),
            )


def _check_state(exists: bool, replace: bool):
    if exists and not replace:
        raise MasterListExists
    if replace and not exists:
        raise NoMasterList


SCHEMA = "invoice_checker"
POSTGRES_TABLES = f"""
CREATE SCHEMA IF NOT EXISTS {SCHEMA};
CREATE TABLE IF NOT EXISTS {SCHEMA}.invoices (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, document_hash TEXT NOT NULL,
    status TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, error TEXT, price_sheet_version TEXT NOT NULL,
    document JSONB, invoice JSONB, check_result JSONB,
    outcome TEXT, outcome_reason TEXT, decided_at TEXT
);
CREATE INDEX IF NOT EXISTS invoice_time ON {SCHEMA}.invoices (created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS {SCHEMA}.invoice_files (
    id TEXT PRIMARY KEY REFERENCES {SCHEMA}.invoices(id) ON DELETE CASCADE,
    content BYTEA NOT NULL
);
CREATE TABLE IF NOT EXISTS {SCHEMA}.master_lists (
    seq BIGSERIAL PRIMARY KEY, id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
    document JSONB NOT NULL, event JSONB NOT NULL, source BYTEA NOT NULL
);
"""


class PostgresStore:
    """Postgres, in its own schema so it can share a Supabase project with other apps.

    PDFs are kept in the database and copied to `directory/files` when the reader or the file
    route needs a path, so the local disk is only a cache.
    """

    def __init__(self, url: str, directory: Path):
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        self.directory = directory.resolve()
        self.files = self.directory / "files"
        self.files.mkdir(parents=True, exist_ok=True)
        # Supabase's pooler does not keep server-side prepared statements across connections.
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=4,
            kwargs={"row_factory": dict_row, "prepare_threshold": None},
            open=True,
        )
        with self.connect() as db:
            db.execute(POSTGRES_TABLES)

    @contextmanager
    def connect(self):
        with self.pool.connection() as db:
            yield db

    def recover(self):
        with self.connect() as db:
            db.execute(
                f"""UPDATE {SCHEMA}.invoices SET status='failed', error=%s, updated_at=%s
                WHERE status NOT IN ('completed', 'failed')""",
                (INTERRUPTED, now()),
            )

    def path(self, invoice_id: str):
        local = self.files / f"{invoice_id}.pdf"
        if not local.exists():
            with self.connect() as db:
                row = db.execute(
                    f"SELECT content FROM {SCHEMA}.invoice_files WHERE id=%s", (invoice_id,)
                ).fetchone()
            if row is not None:
                self.files.mkdir(parents=True, exist_ok=True)
                local.write_bytes(row["content"])
        return local

    def insert(self, invoice_id, filename, document_hash, mode, price_sheet_version):
        # The upload has already been written to path(); keep the bytes with the row.
        at = now()
        content = self.path(invoice_id).read_bytes()
        with self.connect() as db:
            db.execute(
                f"""INSERT INTO {SCHEMA}.invoices
                (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version)
                VALUES (%s,%s,%s,'reading',%s,%s,%s,%s)""",
                (invoice_id, filename, document_hash, mode, at, at, price_sheet_version),
            )
            db.execute(
                f"INSERT INTO {SCHEMA}.invoice_files (id, content) VALUES (%s, %s)",
                (invoice_id, content),
            )

    def update(self, invoice_id, status, *, document=None, invoice=None, check=None, error=None):
        from psycopg.types.json import Jsonb

        def blob(model):
            return Jsonb(model.model_dump(mode="json")) if model is not None else None

        with self.connect() as db:
            db.execute(
                f"""UPDATE {SCHEMA}.invoices SET status=%s, updated_at=%s, error=%s,
                document=COALESCE(%s::jsonb, document), invoice=COALESCE(%s::jsonb, invoice),
                check_result=COALESCE(%s::jsonb, check_result) WHERE id=%s""",
                (status, now(), error, blob(document), blob(invoice), blob(check), invoice_id),
            )

    def decide(self, invoice_id: str, outcome: str | None, reason: str | None):
        with self.connect() as db:
            db.execute(
                f"""UPDATE {SCHEMA}.invoices SET outcome=%s, outcome_reason=%s, decided_at=%s
                WHERE id=%s""",
                (outcome, reason, now() if outcome else None, invoice_id),
            )

    def get(self, invoice_id: str) -> SavedInvoice | None:
        with self.connect() as db:
            row = db.execute(
                f"SELECT * FROM {SCHEMA}.invoices WHERE id=%s", (invoice_id,)
            ).fetchone()
        return None if row is None else _saved(row, invoice_id)

    def list(self, limit: int, offset: int) -> list[InvoiceSummary]:
        with self.connect() as db:
            rows = db.execute(
                f"""SELECT {SUMMARY} FROM {SCHEMA}.invoices
                ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (limit, offset),
            ).fetchall()
        return [InvoiceSummary(**row) for row in rows]

    def latest_master_list(self) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                f"SELECT document FROM {SCHEMA}.master_lists ORDER BY seq DESC LIMIT 1"
            ).fetchone()
        return row["document"] if row else None

    def master_list_events(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                f"SELECT event FROM {SCHEMA}.master_lists ORDER BY seq DESC"
            ).fetchall()
        return [row["event"] for row in rows]

    def add_master_list(self, document: dict, event: dict, source: bytes, *, replace: bool):
        from psycopg.types.json import Jsonb

        with self.connect() as db, db.transaction():
            db.execute(f"LOCK TABLE {SCHEMA}.master_lists IN SHARE ROW EXCLUSIVE MODE")
            exists = db.execute(f"SELECT 1 FROM {SCHEMA}.master_lists LIMIT 1").fetchone()
            _check_state(exists is not None, replace)
            db.execute(
                f"""INSERT INTO {SCHEMA}.master_lists (id, created_at, document, event, source)
                VALUES (%s,%s,%s,%s,%s)""",
                (document["id"], document["uploadedAt"], Jsonb(document), Jsonb(event), source),
            )
