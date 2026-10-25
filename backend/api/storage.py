"""Single-machine persistence. No invoice data or local file paths in the public repo."""

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Request

from .auth import extract_request_claims, is_auth_required
from .contracts import InvoiceSummary, SavedInvoice

DEFAULT_SESSION_ID = "default"
_SESSION_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")

# The AP clerk's decision. Added after the first release, so older databases gain the columns.
OUTCOME_COLUMNS = ("outcome", "outcome_reason", "decided_at")


def now():
    return datetime.now(timezone.utc).isoformat()


def normalize_session_id(session_id: str | None) -> str:
    if not session_id:
        return DEFAULT_SESSION_ID
    cleaned = session_id.strip()
    if not cleaned or len(cleaned) > 128:
        return DEFAULT_SESSION_ID
    return cleaned


def request_session_id(request: Request, query_session_id: str | None = None) -> str:
    claims = extract_request_claims(request, query_session_id)
    if claims is not None:
        return normalize_session_id(claims["session_id"])
    if is_auth_required():
        return DEFAULT_SESSION_ID
    candidates = (
        request.headers.get("x-invoice-session"),
        query_session_id,
        request.query_params.get("session_id"),
        request.cookies.get("ic_session"),
    )
    for raw in candidates:
        if not raw:
            continue
        cleaned = raw.strip()
        if _SESSION_TOKEN_RE.match(cleaned):
            return normalize_session_id(cleaned)
    return DEFAULT_SESSION_ID


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
                document TEXT, invoice TEXT, check_result TEXT,
                outcome TEXT, outcome_reason TEXT, decided_at TEXT,
                session_id TEXT NOT NULL DEFAULT 'default'
            )""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS invoice_time ON invoices(created_at DESC, id DESC)"
            )
            present = {row["name"] for row in db.execute("PRAGMA table_info(invoices)")}
            for column in OUTCOME_COLUMNS:
                if column not in present:
                    db.execute(f"ALTER TABLE invoices ADD COLUMN {column} TEXT")
            if "session_id" not in present:
                db.execute(
                    "ALTER TABLE invoices ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'"
                )
            db.execute(
                "CREATE INDEX IF NOT EXISTS invoice_session_time "
                "ON invoices(session_id, created_at DESC, id DESC)"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30.0)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=30000")
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

    def insert(
        self,
        invoice_id,
        filename,
        document_hash,
        mode,
        price_sheet_version,
        *,
        session_id: str = DEFAULT_SESSION_ID,
    ):
        at = now()
        sid = normalize_session_id(session_id)
        with self.connect() as db:
            db.execute(
                """INSERT INTO invoices
                (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version,session_id)
                VALUES (?,?,?,'reading',?,?,?,?,?)""",
                (invoice_id, filename, document_hash, mode, at, at, price_sheet_version, sid),
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

    def decide(
        self,
        invoice_id: str,
        outcome: str | None,
        reason: str | None,
        *,
        session_id: str | None = None,
    ):
        """Save or clear the outcome. The decision time is the service's clock, never the caller's."""
        decided_at = now() if outcome else None
        with self.connect() as db:
            if session_id is None:
                db.execute(
                    "UPDATE invoices SET outcome=?, outcome_reason=?, decided_at=? WHERE id=?",
                    (outcome, reason, decided_at, invoice_id),
                )
            else:
                sid = normalize_session_id(session_id)
                db.execute(
                    "UPDATE invoices SET outcome=?, outcome_reason=?, decided_at=? "
                    "WHERE id=? AND session_id=?",
                    (outcome, reason, decided_at, invoice_id, sid),
                )

    def get(self, invoice_id: str, *, session_id: str | None = None) -> SavedInvoice | None:
        with self.connect() as db:
            if session_id is None:
                row = db.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
            else:
                sid = normalize_session_id(session_id)
                row = db.execute(
                    "SELECT * FROM invoices WHERE id=? AND session_id=?",
                    (invoice_id, sid),
                ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data.pop("session_id", None)
        data["check"] = data.pop("check_result")
        for key in ("document", "invoice", "check"):
            data[key] = json.loads(data[key]) if data[key] else None
        return SavedInvoice(**data, file_url=f"/invoices/{invoice_id}/file")

    def list(
        self, limit: int, offset: int, *, session_id: str | None = None
    ) -> list[InvoiceSummary]:
        with self.connect() as db:
            if session_id is None:
                rows = db.execute(
                    """SELECT id,filename,document_hash,status,mode,created_at,
                    updated_at,error,price_sheet_version,outcome,outcome_reason,decided_at
                    FROM invoices
                    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
                    (limit, offset),
                ).fetchall()
            else:
                sid = normalize_session_id(session_id)
                rows = db.execute(
                    """SELECT id,filename,document_hash,status,mode,created_at,
                    updated_at,error,price_sheet_version,outcome,outcome_reason,decided_at
                    FROM invoices
                    WHERE session_id=?
                    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
                    (sid, limit, offset),
                ).fetchall()
        return [InvoiceSummary(**dict(row)) for row in rows]
