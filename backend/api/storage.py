"""Persistence. SQLite on one machine by default; Postgres when DATABASE_URL is set.

Both stores keep the same three things: the invoices with their JSON stages, the uploaded PDFs,
and the master-list versions. No invoice data or local file paths in the public repo.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import HTTPException, Request

from .auth import extract_request_claims, is_auth_required
from .contracts import InvoiceSummary, SavedInvoice
from .job_schema import JOB_SCHEMA
from .project_storage import ProjectStore, legacy_project_id

DEFAULT_SESSION_ID = "default"
_SESSION_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")

INTERRUPTED = "Processing was interrupted by a service restart; upload again to retry"
# The AP clerk's decision. Added after the first release, so older databases gain the columns.
OUTCOME_COLUMNS = ("outcome", "outcome_reason", "decided_at")
SUMMARY = (
    "id,filename,document_hash,status,mode,created_at,updated_at,error,price_sheet_version,project_id,comparison_mode,"
    + ",".join(OUTCOME_COLUMNS)
)


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
        return normalize_session_id(claims["workspace_id"])
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


def open_store(directory: Path):
    """Postgres when DATABASE_URL is set (Supabase in production), else SQLite in `directory`."""
    url = os.environ.get("DATABASE_URL", "").strip()
    return PostgresStore(url, directory) if url else Store(directory)


class MasterListExists(Exception):
    """An initial upload was attempted when a master list is already saved."""


class NoMasterList(Exception):
    """A replacement was attempted before any master list was saved."""


class StorageUnavailable(RuntimeError):
    """A bounded database wait failed; callers may retry without private details."""


def _saved(row: dict, invoice_id: str) -> SavedInvoice:
    data = dict(row)
    data.pop("session_id", None)
    data["check"] = data.pop("check_result")
    for key in ("document", "invoice", "check"):
        value = data[key]
        data[key] = json.loads(value) if isinstance(value, str) else value
    return SavedInvoice(**data, file_url=f"/invoices/{invoice_id}/file")


def _loaded(value):
    return json.loads(value) if isinstance(value, str) else value


class Store(ProjectStore):
    """SQLite in one directory. One uvicorn worker only."""

    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        self.files = self.directory / "files"
        self.files.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / "invoices.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(JOB_SCHEMA.format(prefix=""))
            db.execute("""CREATE TABLE IF NOT EXISTS revoked_sessions (
                session_id TEXT PRIMARY KEY, expires_at BIGINT NOT NULL
            )""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS revoked_session_expiry ON revoked_sessions(expires_at)"
            )
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
            if "session_id" not in present:
                db.execute(
                    "ALTER TABLE invoices ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'"
                )
            db.execute(
                "CREATE INDEX IF NOT EXISTS invoice_session_time "
                "ON invoices(session_id, created_at DESC, id DESC)"
            )
            db.execute("""CREATE TABLE IF NOT EXISTS master_lists (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL,
                event TEXT NOT NULL, source BLOB NOT NULL
            )""")

            present = {row["name"] for row in db.execute("PRAGMA table_info(master_lists)")}
            if "session_id" not in present:
                db.execute(
                    "ALTER TABLE master_lists ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'"
                )
            db.execute(
                "CREATE INDEX IF NOT EXISTS master_lists_session_idx "
                "ON master_lists(session_id, created_at DESC)"
            )

            db.execute("""CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL,
                comparison_mode TEXT NOT NULL CHECK(comparison_mode IN ('master_list','totals_only')),
                created_at TEXT NOT NULL, UNIQUE(id,session_id))""")
            for table in ("invoices", "master_lists"):
                columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
                if "project_id" not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN project_id TEXT")
                if table == "invoices" and "comparison_mode" not in columns:
                    db.execute(
                        "ALTER TABLE invoices ADD COLUMN comparison_mode TEXT NOT NULL DEFAULT 'master_list'"
                    )
                db.execute(f"""INSERT OR IGNORE INTO projects
                    SELECT 'legacy:' || session_id,session_id,'Existing invoices','master_list',MIN(created_at)
                    FROM {table} WHERE project_id IS NULL GROUP BY session_id""")
                db.execute(
                    f"UPDATE {table} SET project_id='legacy:' || session_id WHERE project_id IS NULL"
                )
                db.execute(
                    f"CREATE INDEX IF NOT EXISTS {table}_project_idx ON {table}(session_id,project_id,created_at)"
                )
                for action in ("INSERT", "UPDATE"):
                    db.execute(f"""CREATE TRIGGER IF NOT EXISTS {table}_project_{action.lower()}
                        BEFORE {action} ON {table} WHEN NOT EXISTS
                        (SELECT 1 FROM projects WHERE id=NEW.project_id AND session_id=NEW.session_id)
                        BEGIN SELECT RAISE(ABORT, 'Invalid project owner'); END""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10.0)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        except sqlite3.OperationalError as exc:
            if (getattr(exc, "sqlite_errorcode", 0) & 255) in {
                sqlite3.SQLITE_BUSY,
                sqlite3.SQLITE_LOCKED,
                sqlite3.SQLITE_FULL,
                sqlite3.SQLITE_IOERR,
            }:
                raise StorageUnavailable("The database is temporarily unavailable") from exc
            raise
        finally:
            db.close()

    def revoke_session(self, session_id: str, expires_at: int) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM revoked_sessions WHERE expires_at <= ?", (int(time.time()),))
            db.execute(
                "INSERT INTO revoked_sessions (session_id, expires_at) VALUES (?, ?) "
                "ON CONFLICT(session_id) DO UPDATE SET expires_at=MAX(revoked_sessions.expires_at, excluded.expires_at)",
                (session_id, expires_at),
            )

    def is_session_revoked(self, session_id: str) -> bool:
        with self.connect() as db:
            return (
                db.execute(
                    "SELECT 1 FROM revoked_sessions WHERE session_id=? AND expires_at>?",
                    (session_id, int(time.time())),
                ).fetchone()
                is not None
            )

    def recover(self):
        # Completed rows are never reprocessed on startup.
        with self.connect() as db:
            db.execute(
                """UPDATE invoices SET status='failed', error=?, updated_at=?
                WHERE status NOT IN ('completed', 'failed') AND NOT EXISTS (SELECT 1 FROM invoice_jobs j WHERE j.invoice_id=invoices.id AND j.status IN ('queued','running'))""",
                (INTERRUPTED, now()),
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
        project_id: str | None = None,
        comparison_mode: str = "master_list",
        session_id: str = DEFAULT_SESSION_ID,
        limits=None,
    ):
        project_id = project_id or self.ensure_legacy_project(normalize_session_id(session_id))
        at = now()
        sid = normalize_session_id(session_id)
        with self.connect() as db:
            if limits is not None:
                limits.reserve_invoices(
                    sid,
                    1,
                    int(not filename.lower().endswith(".xml")),
                    self.path(invoice_id).stat().st_size,
                    db=db,
                )
            db.execute(
                """INSERT INTO invoices
                (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version,session_id,project_id,comparison_mode)
                VALUES (?,?,?,'reading',?,?,?,?,?,?,?)""",
                (
                    invoice_id,
                    filename,
                    document_hash,
                    mode,
                    at,
                    at,
                    price_sheet_version,
                    sid,
                    project_id,
                    comparison_mode,
                ),
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
        self,
        limit: int,
        offset: int,
        *,
        session_id: str | None = None,
        project_id: str | None = None,
    ) -> list[InvoiceSummary]:
        clauses, params = [], []
        if session_id is not None:
            clauses.append("session_id=?")
            params.append(normalize_session_id(session_id))
        if project_id is not None:
            clauses.append("project_id=?")
            params.append(project_id)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as db:
            rows = db.execute(
                f"SELECT {SUMMARY} FROM invoices{where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
        return [InvoiceSummary(**dict(row)) for row in rows]

    def latest_master_list(
        self, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT document FROM master_lists WHERE session_id=? AND project_id=? ORDER BY rowid DESC LIMIT 1",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                ),
            ).fetchone()
        return _loaded(row["document"]) if row else None

    def master_list_version(
        self, version: str, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> dict | None:
        """The newest saved master list with this version, or None."""
        with self.connect() as db:
            row = db.execute(
                "SELECT document FROM master_lists WHERE session_id=? AND project_id=? AND json_extract(document, '$.version') = ? "
                "ORDER BY rowid DESC LIMIT 1",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                    version,
                ),
            ).fetchone()
        return _loaded(row["document"]) if row else None

    def master_list_events(
        self, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT event FROM master_lists WHERE session_id=? AND project_id=? ORDER BY rowid DESC",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                ),
            ).fetchall()
        return [_loaded(row["event"]) for row in rows]

    def add_master_list(
        self,
        document: dict,
        event: dict,
        source: bytes,
        *,
        replace: bool,
        session_id: str = DEFAULT_SESSION_ID,
        project_id: str | None = None,
        limits=None,
    ):
        """Save one version. The first upload must find none; a replacement must find one."""
        project_id = project_id or self.ensure_legacy_project(normalize_session_id(session_id))
        with self.connect() as db:
            # One transaction serialises replacements and keeps the version order.
            db.execute("BEGIN IMMEDIATE")
            exists = (
                db.execute(
                    "SELECT 1 FROM master_lists WHERE session_id=? AND project_id=? LIMIT 1",
                    (
                        normalize_session_id(session_id),
                        project_id or legacy_project_id(normalize_session_id(session_id)),
                    ),
                ).fetchone()
                is not None
            )
            _check_state(exists, replace)
            if limits is not None:
                limits.reserve_storage(
                    normalize_session_id(session_id),
                    len(source),
                    maximum=limits.storage_maximum(),
                    db=db,
                )
            db.execute(
                "INSERT INTO master_lists (id,created_at,document,event,source,session_id,project_id) VALUES (?,?,?,?,?,?,?)",
                (
                    document["id"],
                    document["uploadedAt"],
                    json.dumps(document),
                    json.dumps(event),
                    source,
                    normalize_session_id(session_id),
                    project_id,
                ),
            )


def _check_state(exists: bool, replace: bool):
    if exists and not replace:
        raise MasterListExists
    if replace and not exists:
        raise NoMasterList


SCHEMA = "invoice_checker"
SCHEMA_NAME = re.compile(r"^[a-z_][a-z0-9_]*$")
POSTGRES_TABLES = """
CREATE SCHEMA IF NOT EXISTS {schema};
CREATE TABLE IF NOT EXISTS {schema}.revoked_sessions (
    session_id TEXT PRIMARY KEY, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_session_expiry ON {schema}.revoked_sessions(expires_at);
CREATE TABLE IF NOT EXISTS {schema}.invoices (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, document_hash TEXT NOT NULL,
    status TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, error TEXT, price_sheet_version TEXT NOT NULL,
    document JSONB, invoice JSONB, check_result JSONB,
    outcome TEXT, outcome_reason TEXT, decided_at TEXT
);
CREATE INDEX IF NOT EXISTS invoice_time ON {schema}.invoices (created_at DESC, id DESC);
ALTER TABLE {schema}.invoices ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS invoice_session_time ON {schema}.invoices (session_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS {schema}.invoice_files (
    id TEXT PRIMARY KEY REFERENCES {schema}.invoices(id) ON DELETE CASCADE,
    content BYTEA NOT NULL
);
CREATE TABLE IF NOT EXISTS {schema}.master_lists (
    seq BIGSERIAL PRIMARY KEY, id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
    document JSONB NOT NULL, event JSONB NOT NULL, source BYTEA NOT NULL
);
ALTER TABLE {schema}.master_lists ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS master_lists_session_idx ON {schema}.master_lists (session_id, seq DESC);
"""


POSTGRES_TABLES += JOB_SCHEMA.replace("{prefix}", "{schema}.")


class PostgresStore(ProjectStore):
    """Postgres, in its own schema so it can share a Supabase project with other apps.

    PDFs are kept in the database and copied to `directory/files` when the reader or the file
    route needs a path, so the local disk is only a cache.
    """

    def __init__(self, url: str, directory: Path, *, schema: str = SCHEMA):
        # The name is put into SQL text, so only a plain lowercase identifier is accepted.
        if not SCHEMA_NAME.fullmatch(schema):
            raise ValueError(f"Invalid Postgres schema name: {schema!r}")

        from psycopg.conninfo import conninfo_to_dict
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        host = conninfo_to_dict(url).get("host", "")
        self.storage_profile = os.environ.get(
            "INVOICE_STORAGE_PROFILE", "supabase_free" if ".supabase." in host else "custom"
        )
        self.source_budget_default_mb = 400 if self.storage_profile == "supabase_free" else 1024
        budget_mb = int(
            os.environ.get(
                "INVOICE_DATABASE_BUDGET_MB",
                "400" if self.storage_profile == "supabase_free" else "0",
            )
        )
        if budget_mb < 0:
            raise ValueError("INVOICE_DATABASE_BUDGET_MB must be non-negative")
        self.database_budget_bytes = budget_mb * 1024 * 1024
        self.schema = schema
        self.directory = directory.resolve()
        self.files = self.directory / "files"
        self.files.mkdir(parents=True, exist_ok=True)
        # Supabase's pooler does not keep server-side prepared statements across connections.
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=4,
            timeout=10,
            max_waiting=16,
            kwargs={
                "row_factory": dict_row,
                "prepare_threshold": None,
                "connect_timeout": 5,
                "keepalives_idle": 30,
                "keepalives_interval": 10,
                "keepalives_count": 3,
                "tcp_user_timeout": 60000,
            },
            open=True,
        )
        with self.connect() as db:
            db.execute(POSTGRES_TABLES.format(schema=self.schema))
            migration = (Path(__file__).parents[1] / "migrations/001_projects.sql").read_text()
            db.execute(
                migration.replace("invoice_checker", self.schema)
                .replace("BEGIN;", "")
                .replace("COMMIT;", "")
            )

    @contextmanager
    def connect(self):
        from psycopg import InterfaceError, OperationalError
        from psycopg.errors import LockNotAvailable, QueryCanceled, ReadOnlySqlTransaction
        from psycopg_pool import PoolTimeout, TooManyRequests

        try:
            with self.pool.connection() as db:
                # Transaction-local settings also work with transaction poolers.
                db.execute(
                    "SELECT set_config('statement_timeout','30000',true), set_config('lock_timeout','10000',true)"
                )
                yield db
        except (
            PoolTimeout,
            TooManyRequests,
            QueryCanceled,
            LockNotAvailable,
            OperationalError,
            InterfaceError,
            ReadOnlySqlTransaction,
        ) as exc:
            raise StorageUnavailable("The database is temporarily unavailable") from exc

    def check_growth(self, db, addition):
        """Guard source and parsed-result writes using the whole database size."""
        budget = getattr(self, "database_budget_bytes", 0)
        if not budget or addition <= 0:
            return
        present = db.execute(
            f"SELECT reserved FROM {self.schema}.fleet_storage WHERE id='main'"
        ).fetchone()
        if present is None:
            db.execute(
                f"INSERT INTO {self.schema}.fleet_storage (id,reserved) SELECT 'main', (SELECT COALESCE(SUM(octet_length(content)),0) FROM {self.schema}.invoice_files) + (SELECT COALESCE(SUM(octet_length(source)),0) FROM {self.schema}.master_lists) ON CONFLICT(id) DO NOTHING"
            )
        db.execute(f"UPDATE {self.schema}.fleet_storage SET reserved=reserved WHERE id='main'")
        used = db.execute("SELECT pg_database_size(current_database()) AS bytes").fetchone()[
            "bytes"
        ]
        if used + addition > budget:
            raise HTTPException(
                413,
                "The database storage budget is nearly full. New uploads/results are paused to preserve existing data. Contact your administrator.",
            )

    def revoke_session(self, session_id: str, expires_at: int) -> None:
        with self.connect() as db:
            db.execute(
                f"DELETE FROM {self.schema}.revoked_sessions WHERE expires_at <= %s",
                (int(time.time()),),
            )
            db.execute(
                f"INSERT INTO {self.schema}.revoked_sessions AS revoked (session_id, expires_at) VALUES (%s, %s) "
                "ON CONFLICT(session_id) DO UPDATE SET expires_at=GREATEST(revoked.expires_at, excluded.expires_at)",
                (session_id, expires_at),
            )

    def is_session_revoked(self, session_id: str) -> bool:
        with self.connect() as db:
            return (
                db.execute(
                    f"SELECT 1 FROM {self.schema}.revoked_sessions WHERE session_id=%s AND expires_at>%s",
                    (session_id, int(time.time())),
                ).fetchone()
                is not None
            )

    def recover(self):
        with self.connect() as db:
            db.execute(
                f"""UPDATE {self.schema}.invoices SET status='failed', error=%s, updated_at=%s
                WHERE status NOT IN ('completed', 'failed') AND NOT EXISTS (SELECT 1 FROM {self.schema}.invoice_jobs j WHERE j.invoice_id={self.schema}.invoices.id AND j.status IN ('queued','running'))""",
                (INTERRUPTED, now()),
            )

    def path(self, invoice_id: str):
        local = self.files / f"{invoice_id}.pdf"
        if not local.exists():
            with self.connect() as db:
                row = db.execute(
                    f"SELECT content FROM {self.schema}.invoice_files WHERE id=%s", (invoice_id,)
                ).fetchone()
            if row is not None:
                self.files.mkdir(parents=True, exist_ok=True)
                temporary = None
                try:
                    with NamedTemporaryFile(
                        dir=self.files, prefix=f".{invoice_id}-", suffix=".tmp", delete=False
                    ) as output:
                        temporary = Path(output.name)
                        output.write(row["content"])
                        output.flush()
                        os.fsync(output.fileno())
                    try:
                        os.replace(temporary, local)
                    except OSError:
                        # A concurrent reader may already have published/opened
                        # the same immutable source (including on Windows).
                        if not local.exists():
                            raise
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
        return local

    def insert(
        self,
        invoice_id,
        filename,
        document_hash,
        mode,
        price_sheet_version,
        *,
        project_id: str | None = None,
        comparison_mode: str = "master_list",
        session_id: str = DEFAULT_SESSION_ID,
        limits=None,
    ):
        # The upload has already been written to path(); keep the bytes with the row.
        project_id = project_id or self.ensure_legacy_project(normalize_session_id(session_id))
        at = now()
        content = self.path(invoice_id).read_bytes()
        with self.connect() as db:
            if limits is not None:
                limits.reserve_invoices(
                    normalize_session_id(session_id),
                    1,
                    int(not filename.lower().endswith(".xml")),
                    len(content),
                    db=db,
                )
            db.execute(
                f"""INSERT INTO {self.schema}.invoices
                (id,filename,document_hash,status,mode,created_at,updated_at,price_sheet_version,session_id,project_id,comparison_mode)
                VALUES (%s,%s,%s,'reading',%s,%s,%s,%s,%s,%s,%s)""",
                (
                    invoice_id,
                    filename,
                    document_hash,
                    mode,
                    at,
                    at,
                    price_sheet_version,
                    normalize_session_id(session_id),
                    project_id,
                    comparison_mode,
                ),
            )
            db.execute(
                f"INSERT INTO {self.schema}.invoice_files (id, content) VALUES (%s, %s)",
                (invoice_id, content),
            )

    def update(self, invoice_id, status, *, document=None, invoice=None, check=None, error=None):
        from psycopg.types.json import Jsonb

        def blob(model):
            return Jsonb(model.model_dump(mode="json")) if model is not None else None

        with self.connect() as db:
            self.check_growth(
                db,
                sum(
                    len(model.model_dump_json().encode("utf-8"))
                    for model in (document, invoice, check)
                    if model is not None
                ),
            )
            db.execute(
                f"""UPDATE {self.schema}.invoices SET status=%s, updated_at=%s, error=%s,
                document=COALESCE(%s::jsonb, document), invoice=COALESCE(%s::jsonb, invoice),
                check_result=COALESCE(%s::jsonb, check_result) WHERE id=%s""",
                (status, now(), error, blob(document), blob(invoice), blob(check), invoice_id),
            )

    def decide(
        self,
        invoice_id: str,
        outcome: str | None,
        reason: str | None,
        *,
        session_id: str | None = None,
    ):
        params = (outcome, reason, now() if outcome else None, invoice_id)
        clause = ""
        if session_id is not None:
            clause = " AND session_id=%s"
            params += (normalize_session_id(session_id),)
        with self.connect() as db:
            db.execute(
                f"UPDATE {self.schema}.invoices SET outcome=%s, outcome_reason=%s, decided_at=%s WHERE id=%s{clause}",
                params,
            )

    def get(self, invoice_id: str, *, session_id: str | None = None) -> SavedInvoice | None:
        clause = "" if session_id is None else " AND session_id=%s"
        params = (
            (invoice_id,) if session_id is None else (invoice_id, normalize_session_id(session_id))
        )
        with self.connect() as db:
            row = db.execute(
                f"SELECT * FROM {self.schema}.invoices WHERE id=%s{clause}", params
            ).fetchone()
        return None if row is None else _saved(row, invoice_id)

    def list(
        self,
        limit: int,
        offset: int,
        *,
        session_id: str | None = None,
        project_id: str | None = None,
    ) -> list[InvoiceSummary]:
        clauses, params = [], []
        if session_id is not None:
            clauses.append("session_id=%s")
            params.append(normalize_session_id(session_id))
        if project_id is not None:
            clauses.append("project_id=%s")
            params.append(project_id)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as db:
            rows = db.execute(
                f"SELECT {SUMMARY} FROM {self.schema}.invoices{where} ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s",
                (*params, limit, offset),
            ).fetchall()
        return [InvoiceSummary(**row) for row in rows]

    def latest_master_list(
        self, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                f"SELECT document FROM {self.schema}.master_lists WHERE session_id=%s AND project_id=%s ORDER BY seq DESC LIMIT 1",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                ),
            ).fetchone()
        return row["document"] if row else None

    def master_list_version(
        self, version: str, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> dict | None:
        """The newest saved master list with this version, or None."""
        with self.connect() as db:
            row = db.execute(
                f"SELECT document FROM {self.schema}.master_lists WHERE session_id=%s AND project_id=%s AND document->>'version' = %s "
                "ORDER BY seq DESC LIMIT 1",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                    version,
                ),
            ).fetchone()
        return row["document"] if row else None

    def master_list_events(
        self, *, session_id: str = DEFAULT_SESSION_ID, project_id: str | None = None
    ) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                f"SELECT event FROM {self.schema}.master_lists WHERE session_id=%s AND project_id=%s ORDER BY seq DESC",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                ),
            ).fetchall()
        return [row["event"] for row in rows]

    def add_master_list(
        self,
        document: dict,
        event: dict,
        source: bytes,
        *,
        replace: bool,
        session_id: str = DEFAULT_SESSION_ID,
        project_id: str | None = None,
        limits=None,
    ):
        from psycopg.types.json import Jsonb

        project_id = project_id or self.ensure_legacy_project(normalize_session_id(session_id))

        with self.connect() as db, db.transaction():
            db.execute(f"LOCK TABLE {self.schema}.master_lists IN SHARE ROW EXCLUSIVE MODE")
            exists = db.execute(
                f"SELECT 1 FROM {self.schema}.master_lists WHERE session_id=%s AND project_id=%s LIMIT 1",
                (
                    normalize_session_id(session_id),
                    project_id or legacy_project_id(normalize_session_id(session_id)),
                ),
            ).fetchone()
            _check_state(exists is not None, replace)
            if limits is not None:
                limits.reserve_storage(
                    normalize_session_id(session_id),
                    len(source),
                    maximum=limits.storage_maximum(),
                    db=db,
                )
            db.execute(
                f"""INSERT INTO {self.schema}.master_lists (id, created_at, document, event, source, session_id, project_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    document["id"],
                    document["uploadedAt"],
                    Jsonb(document),
                    Jsonb(event),
                    source,
                    normalize_session_id(session_id),
                    project_id,
                ),
            )
