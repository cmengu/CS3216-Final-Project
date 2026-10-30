"""Local demo API: bounded upload → read → extract → check → persist.

Signed sessions protect invoice, master-list and Outlook routes. The mode is explicit:
INVOICE_MODE=fixture replays known answers, INVOICE_MODE=live runs the real steps.
"""

import os
import re
import sys
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from threading import BoundedSemaphore
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from read.bounded import read_pdf_bounded
from read.reader import MAX_BYTES, validate_pdf
from read.xml_invoice import read_xml_invoice

from .account_routes import router as account_router
from .accounts import Accounts
from .auth import (
    COOKIE_NAME,
    CSRF_HEADER,
    CSRF_VALUE,
    extract_request_claims,
    has_invalid_auth_token,
    is_auth_required,
    validate_auth_configuration,
)
from .batches import charge_checks, reserve_upload
from .batches import router as batch_router
from .contracts import InvoiceSummary, OutcomeRequest, SavedInvoice
from .jobs import InvoiceJobs, InvoiceWorker
from .limits import UsageLimits
from .master_list import current_master
from .master_list import router as master_list_router
from .outlook import initialize as initialize_outlook
from .outlook import router as outlook_router
from .processing import process_stored_invoice
from .stages import FixtureStages, Stages
from .storage import Store, open_store, request_session_id
from .uploaded_master import UploadedMasterStages

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    if "pytest" in sys.modules:
        return
    env_file = BACKEND_DIR / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def _request_session_id(request: Request, query_session_id: str | None = None) -> str:
    return request_session_id(request, query_session_id)


def _slot_wait_seconds() -> float:
    raw = os.environ.get("INVOICE_SLOT_WAIT_SECONDS")
    if raw is not None:
        try:
            return max(0.0, float(raw))
        except ValueError:
            return 0.0
    if "pytest" in sys.modules:
        return 0.0
    return 45.0


def create_app(
    *,
    storage_dir: Path | None = None,
    stages: Stages | None = None,
    reader=read_pdf_bounded,
    start_worker: bool = True,
) -> FastAPI:
    _load_dotenv()
    store_dir = storage_dir or Path(os.environ.get("INVOICE_DATA_DIR", ROOT / "backend/runtime"))

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = open_store(store_dir)
        if is_auth_required():
            validate_auth_configuration()
        app.state.accounts = (
            Accounts(app.state.store) if hasattr(app.state.store, "connect") else None
        )
        app.state.limits = (
            UsageLimits(app.state.store) if hasattr(app.state.store, "connect") else None
        )
        if app.state.accounts:
            app.state.accounts.bootstrap_configured_admin()
            if (
                is_auth_required()
                and not app.state.accounts.has_accounts()
                and len(os.environ.get("AUTH_SETUP_TOKEN", "")) < 32
            ):
                raise ValueError(
                    "Prepare a one-time admin setup link or configure a non-default bootstrap admin."
                )
        app.state.jobs = (
            InvoiceJobs(app.state.store) if hasattr(app.state.store, "connect") else None
        )
        app.state.reader = reader
        app.state.store.recover()
        # Outlook keeps its sign-in tokens in SQLite on the service's own disk, even when invoices
        # and master lists are in Postgres: its queries are written for SQLite.
        app.state.outlook_store = (
            app.state.store if isinstance(app.state.store, Store) else Store(store_dir)
        )
        initialize_outlook(app.state.outlook_store)
        app.state.stages = stages if stages is not None else _stages_from_environment()
        try:
            max_concurrent = max(1, int(os.environ.get("INVOICE_MAX_CONCURRENT_UPLOADS", "1")))
        except ValueError:
            max_concurrent = 1
        app.state.slot = BoundedSemaphore(max_concurrent)
        worker = InvoiceWorker(app) if start_worker and app.state.jobs else None
        app.state.worker = worker
        if worker:
            worker.start()
        try:
            yield
        finally:
            if worker:
                worker.stop()
            if hasattr(app.state.store, "pool"):
                app.state.store.pool.close()

    cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://100.89.215.68:3000",
    ]
    for env_key in ("FRONTEND_URL", "CORS_ORIGINS", "INVOICE_ALLOWED_ORIGINS"):
        for item in os.environ.get(env_key, "").split(","):
            origin = item.strip().rstrip("/")
            if origin and origin not in cors_origins:
                cors_origins.append(origin)
    # Preview deployments get a new address each time, so they are allowed by pattern.
    cors_origin_regex = os.environ.get("INVOICE_ALLOWED_ORIGIN_REGEX", "").strip() or None

    trusted_origin_pattern = re.compile(cors_origin_regex) if cors_origin_regex else None

    app = FastAPI(title="Invoice Checker", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Validation errors must never echo passwords, setup codes, or document inputs.
        errors = [
            {key: value for key, value in error.items() if key not in {"input", "ctx"}}
            for error in exc.errors()
        ]
        return JSONResponse({"detail": jsonable_encoder(errors)}, status_code=422)

    app.include_router(account_router)
    app.include_router(batch_router)
    app.include_router(master_list_router)
    app.include_router(outlook_router)

    @app.middleware("http")
    async def advertised_size(request, call_next):
        size = request.headers.get("content-length")
        request_limit = (
            101 * 1024 * 1024
            if request.url.path.rstrip("/") == "/invoice-batches"
            else MAX_BYTES + 65536
        )
        if request.url.path.startswith(("/auth/", "/admin/")):
            request_limit = 16 * 1024
        if size:
            try:
                if int(size) > request_limit:
                    return JSONResponse(
                        {"detail": "Upload exceeds the allowed request size"}, status_code=413
                    )
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        path = request.url.path
        # Custom headers cannot be submitted by cross-site HTML forms. Browser AJAX from
        # other origins additionally has to pass the credentialed CORS preflight allowlist.
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            browser_mutation = bool(request.cookies.get(COOKIE_NAME)) or path in {
                "/auth/sign-in",
                "/auth/sign-out",
                "/auth/setup",
            }
            if browser_mutation:
                origin = request.headers.get("origin")
                trusted = origin is None or (
                    origin != "null"
                    and (
                        origin in cors_origins
                        or origin == f"{request.url.scheme}://{request.url.netloc}"
                        or (
                            trusted_origin_pattern is not None
                            and trusted_origin_pattern.fullmatch(origin)
                        )
                    )
                )
                if request.headers.get(CSRF_HEADER) != CSRF_VALUE or not trusted:
                    return JSONResponse(
                        {"detail": "Request origin or CSRF protection header is invalid"},
                        status_code=403,
                        headers={"Cache-Control": "no-store"},
                    )
        if path == "/auth/sign-in" and request.method == "POST":
            ip = request.client.host if request.client else "unknown"
            try:
                request.app.state.limits.take("login-ip", ip, maximum=20, seconds=600)
            except HTTPException as exc:
                return JSONResponse(
                    {"detail": exc.detail},
                    status_code=exc.status_code,
                    headers={**(exc.headers or {}), "Cache-Control": "no-store"},
                )
        protected = path.startswith(
            (
                "/invoices",
                "/master-list",
                "/outlook",
                "/auth/outlook/login",
                "/admin",
                "/invoice-batches",
            )
        )
        if protected and request.method != "OPTIONS":
            if has_invalid_auth_token(request):
                return JSONResponse(
                    {"detail": "Invalid or expired session"},
                    status_code=401,
                    headers={"Cache-Control": "no-store"},
                )
            if is_auth_required() and extract_request_claims(request) is None:
                return JSONResponse(
                    {"detail": "Authentication required"},
                    status_code=401,
                    headers={"Cache-Control": "no-store"},
                )
        response = await call_next(request)
        if path.startswith(
            ("/master-list", "/invoices", "/outlook", "/auth", "/admin", "/invoice-batches")
        ):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=cors_origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health(request: Request):
        selected = app.state.stages
        sid = _request_session_id(request)
        return {
            "status": "ok",
            "mode": selected.mode if selected else "unconfigured",
            "processing_configured": selected is not None
            and (
                not isinstance(selected, UploadedMasterStages)
                or current_master(app.state.store, session_id=sid) is not None
            ),
            "contract": "proposed-v1",
        }

    @app.post("/invoices", response_model=SavedInvoice, status_code=201)
    def upload(request: Request, file: UploadFile, force_ocr: bool = False):
        selected = app.state.stages
        if selected is None:
            file.file.close()
            raise HTTPException(
                503,
                "Extraction/check adapters are unconfigured. Set INVOICE_MODE=fixture for known "
                "dummy PDFs, or INVOICE_MODE=live with a model and uploaded master list.",
            )
        wait_seconds = _slot_wait_seconds()
        acquired = (
            app.state.slot.acquire(blocking=True, timeout=wait_seconds)
            if wait_seconds > 0
            else app.state.slot.acquire(blocking=False)
        )
        if not acquired:
            file.file.close()
            raise HTTPException(
                429,
                "An invoice is processing; retry after it finishes",
                headers={"Retry-After": "5"},
            )
        store = app.state.store
        session_id = _request_session_id(request)
        invoice_id = str(uuid4())
        path = store.path(invoice_id)
        inserted = False
        reserved = 0
        try:
            if isinstance(selected, UploadedMasterStages):
                try:
                    selected = selected.bind(store, session_id=session_id)
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from exc
            filename = (file.filename or "invoice.pdf").replace("\\", "/").rsplit("/", 1)[-1]
            is_xml = filename.lower().endswith(".xml")
            if not filename.lower().endswith((".pdf", ".xml")):
                raise HTTPException(415, "Upload a PDF or Vietnamese HDon XML invoice")
            if is_xml and selected.mode == "fixture":
                raise HTTPException(
                    422,
                    "XML invoices require live mode and a master list; fixture mode only replays known PDFs",
                )
            charge_checks(request, 1, int(not is_xml))
            reserved = reserve_upload(request, file.size or 0)
            size = 0
            with path.open("xb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "Invoice exceeds 20 MiB")
                    target.write(chunk)
            try:
                if is_xml:
                    xml_document, _ = read_xml_invoice(path.read_bytes(), filename)
                    document_hash = xml_document.document_hash
                else:
                    document_hash, _ = validate_pdf(path)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            store.insert(
                invoice_id,
                filename,
                document_hash,
                selected.mode,
                selected.price_sheet_version,
                session_id=session_id,
            )
            inserted = True
            completed = process_stored_invoice(
                path,
                filename,
                document_hash,
                selected,
                reader,
                lambda status, **values: store.update(invoice_id, status, **values),
                force_ocr=force_ocr,
            )
            saved = store.get(invoice_id, session_id=session_id)
            return (
                saved if completed else JSONResponse(saved.model_dump(mode="json"), status_code=422)
            )
        finally:
            file.file.close()
            if not inserted:
                path.unlink(missing_ok=True)
                if reserved:
                    app.state.limits.release_storage(session_id, reserved)
            app.state.slot.release()

    @app.get("/invoices", response_model=list[InvoiceSummary])
    def invoices(
        request: Request,
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        session_id = _request_session_id(request)
        return app.state.store.list(limit, offset, session_id=session_id)

    @app.get("/invoices/{invoice_id}", response_model=SavedInvoice)
    def invoice(invoice_id: UUID, request: Request, session_id: str | None = None):
        sid = _request_session_id(request, session_id)
        saved = app.state.store.get(str(invoice_id), session_id=sid)
        if saved is None:
            raise HTTPException(404, "Invoice not found")
        return saved

    @app.get("/invoices/{invoice_id}/file")
    def invoice_file(invoice_id: UUID, request: Request, session_id: str | None = None):
        saved = invoice(invoice_id, request, session_id)
        path = app.state.store.path(str(invoice_id))
        if not path.is_file():
            raise HTTPException(404, "Original invoice is unavailable")
        return FileResponse(
            path,
            media_type="application/xml"
            if saved.filename.lower().endswith(".xml")
            else "application/pdf",
            headers={"X-Content-Type-Options": "nosniff"},
            filename=saved.filename,
            content_disposition_type="attachment"
            if saved.filename.lower().endswith(".xml")
            else "inline",
        )

    @app.put("/invoices/{invoice_id}/outcome", response_model=SavedInvoice)
    def decide(invoice_id: UUID, request_body: OutcomeRequest, request: Request):
        """Save the AP clerk's decision, or clear it with a null outcome. The clerk alone decides."""
        sid = _request_session_id(request)
        saved = invoice(invoice_id, request, sid)
        reason = (request_body.reason or "").strip() or None
        refusal = _outcome_refusal(saved, request_body.outcome, reason)
        if refusal:
            raise HTTPException(*refusal)
        app.state.store.decide(saved.id, request_body.outcome, reason, session_id=sid)
        return app.state.store.get(saved.id, session_id=sid)

    return app


def _resolve_path(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute() and not path.exists() and (BACKEND_DIR / path).exists():
        return (BACKEND_DIR / path).resolve()
    return path


def _over_sheet_price(saved: SavedInvoice) -> bool:
    return any(
        line.status == "price_mismatch"
        and line.difference is not None
        and Decimal(line.difference) > 0
        for line in saved.check.lines
    )


def _outcome_refusal(saved: SavedInvoice, outcome, reason) -> tuple[int, str] | None:
    """Why this outcome cannot be saved on this invoice, as (status, sentence); None when it can.

    "Ready to pay" is the service's promise that the invoice is clear, so it is held to the same
    rule as the screens' All match: checked in full, a total the service stands behind, and every
    line a match. Anything else that is finished can still be paid, but only with a reason.
    """
    if outcome is None:
        return (422, "Clearing an outcome takes no reason") if reason else None
    if saved.status not in ("completed", "failed"):
        return 409, "The invoice is still being checked; decide once the check has finished"
    if outcome == "ready_to_pay_anyway":
        return None if reason else (422, "Ready to pay anyway needs a short reason")
    checked = saved.status == "completed" and saved.check is not None
    if outcome == "ready_to_pay":
        if (
            not checked
            or saved.check.overcharge_total is None
            or not saved.check.lines
            or any(line.status != "match" for line in saved.check.lines)
        ):
            return 409, "Only an invoice checked in full with every line matching is ready to pay"
        return None
    if not checked or not _over_sheet_price(saved):
        return 409, "Raise with supplier needs a line priced over the sheet"
    return None


def _stages_from_environment() -> Stages | None:
    mode = os.environ.get("INVOICE_MODE")
    if not mode:
        return None
    if mode == "fixture":
        return FixtureStages(Path(os.environ.get("INVOICE_DUMMY_DIR", ROOT / "data/dummy")))
    if mode == "live":
        checker = os.environ.get("INVOICE_CHECKER", "master_list")
        if checker in {"master_list", "csv_context"}:
            if not os.environ.get("OPENAI_API_KEY", "").strip():
                raise ValueError("Set OPENAI_API_KEY in the backend environment for live mode")
            return UploadedMasterStages(model=os.environ.get("OPENAI_MODEL", ""))
        if checker != "standard":
            raise ValueError("INVOICE_CHECKER must be master_list, csv_context or standard")
        sheet = os.environ.get("INVOICE_PRICE_SHEET")
        if not sheet:
            raise ValueError("Set INVOICE_PRICE_SHEET to the price sheet .xlsx for live mode")
        sheet_path = _resolve_path(sheet)
        from .live import LiveStages

        return LiveStages(sheet_path)
    raise ValueError("INVOICE_MODE must be fixture or live")


app = create_app()
