"""Local demo API: bounded upload → read → extract → check → persist.

No auth/connectors in release 1. Bind to loopback, one worker. The mode is always explicit:
INVOICE_MODE=fixture replays known answers, INVOICE_MODE=live runs the real steps.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import BoundedSemaphore
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from read.bounded import read_pdf_bounded
from read.reader import MAX_BYTES, validate_pdf

from .contracts import InvoiceSummary, SavedInvoice
from .stages import FixtureStages, Stages
from .storage import Store

ROOT = Path(__file__).resolve().parents[2]
log = logging.getLogger(__name__)


def create_app(
    *, storage_dir: Path | None = None, stages: Stages | None = None, reader=read_pdf_bounded
) -> FastAPI:
    store_dir = storage_dir or Path(os.environ.get("INVOICE_DATA_DIR", ROOT / "backend/runtime"))

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(store_dir)
        app.state.store.recover()
        app.state.stages = stages if stages is not None else _stages_from_environment()
        app.state.slot = BoundedSemaphore(1)
        yield

    app = FastAPI(title="Invoice Checker", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def advertised_size(request, call_next):
        size = request.headers.get("content-length")
        if size:
            try:
                if int(size) > MAX_BYTES + 65536:
                    return JSONResponse({"detail": "Upload exceeds 20 MiB"}, status_code=413)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        return await call_next(request)

    @app.get("/health")
    def health():
        selected = app.state.stages
        return {
            "status": "ok",
            "mode": selected.mode if selected else "unconfigured",
            "processing_configured": selected is not None,
            "contract": "proposed-v1",
        }

    @app.post("/invoices", response_model=SavedInvoice, status_code=201)
    def upload(file: UploadFile, force_ocr: bool = False):
        selected = app.state.stages
        if selected is None:
            file.file.close()
            raise HTTPException(
                503,
                "Extraction/check adapters are unconfigured. Set INVOICE_MODE=fixture for known "
                "dummy PDFs, or INVOICE_MODE=live with INVOICE_PRICE_SHEET for the real steps.",
            )
        if not app.state.slot.acquire(blocking=False):
            file.file.close()
            raise HTTPException(
                429,
                "An invoice is processing; retry after it finishes",
                headers={"Retry-After": "5"},
            )
        store = app.state.store
        invoice_id = str(uuid4())
        path = store.path(invoice_id)
        inserted = False
        try:
            filename = (file.filename or "invoice.pdf").replace("\\", "/").rsplit("/", 1)[-1]
            if not filename.lower().endswith(".pdf"):
                raise HTTPException(415, "Upload a PDF")
            size = 0
            with path.open("xb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "PDF exceeds 20 MiB")
                    target.write(chunk)
            try:
                document_hash, _ = validate_pdf(path)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            store.insert(
                invoice_id, filename, document_hash, selected.mode, selected.price_sheet_version
            )
            inserted = True
            stage = "reading"
            try:
                document = reader(path, force_ocr=force_ocr)
                if document.document_hash != document_hash:
                    raise ValueError("Reader returned a different document hash")
                document.filename = filename
                stage = "extracting"
                store.update(invoice_id, stage, document=document)
                invoice = selected.extract(document)
                stage = "checking"
                store.update(invoice_id, stage, invoice=invoice)
                check = selected.check(invoice)
                if len(check.lines) != len(invoice.lines) or {
                    x.line_index for x in check.lines
                } != set(range(len(invoice.lines))):
                    raise ValueError(
                        "Checker must return exactly one result for every invoice line"
                    )
                if check.price_sheet_version != selected.price_sheet_version:
                    raise ValueError("Checker returned a different price-sheet version")
                store.update(invoice_id, "completed", check=check)
            except Exception as exc:
                # Persist failures without logging document text, provider response bodies or keys.
                log.warning("Invoice %s failed (%s)", invoice_id, type(exc).__name__)
                store.update(invoice_id, "failed", error=f"{stage}: {_failure_reason(exc)}")
                return JSONResponse(store.get(invoice_id).model_dump(mode="json"), status_code=422)
            return store.get(invoice_id)
        finally:
            file.file.close()
            if not inserted:
                path.unlink(missing_ok=True)
            app.state.slot.release()

    @app.get("/invoices", response_model=list[InvoiceSummary])
    def invoices(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
        return app.state.store.list(limit, offset)

    @app.get("/invoices/{invoice_id}", response_model=SavedInvoice)
    def invoice(invoice_id: UUID):
        saved = app.state.store.get(str(invoice_id))
        if saved is None:
            raise HTTPException(404, "Invoice not found")
        return saved

    @app.get("/invoices/{invoice_id}/file")
    def invoice_file(invoice_id: UUID):
        saved = invoice(invoice_id)
        path = app.state.store.path(str(invoice_id))
        if not path.is_file():
            raise HTTPException(404, "Original PDF is unavailable")
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=saved.filename,
            content_disposition_type="inline",
        )

    return app


def _stages_from_environment() -> Stages | None:
    mode = os.environ.get("INVOICE_MODE")
    if not mode:
        return None
    if mode == "fixture":
        return FixtureStages(Path(os.environ.get("INVOICE_DUMMY_DIR", ROOT / "data/dummy")))
    if mode == "live":
        sheet = os.environ.get("INVOICE_PRICE_SHEET")
        if not sheet:
            raise ValueError("Set INVOICE_PRICE_SHEET to the price sheet .xlsx for live mode")
        checker = os.environ.get("INVOICE_CHECKER", "standard")
        if checker == "csv_context":
            from .csv_live import LiveStages as CsvLiveStages

            if not os.environ.get("OPENAI_API_KEY", "").strip():
                raise ValueError("Set OPENAI_API_KEY in the backend environment for live mode")
            return CsvLiveStages(Path(sheet), model=os.environ.get("OPENAI_MODEL", ""))
        if checker != "standard":
            raise ValueError("INVOICE_CHECKER must be standard or csv_context")
        from .live import LiveStages

        return LiveStages(Path(sheet))
    raise ValueError("INVOICE_MODE must be fixture or live")


def _failure_reason(exc: Exception) -> str:
    """The step's own sentence. Those are written to hold no document text, key or provider body.

    A validation error is a ValueError too, and it quotes the value it rejected, so it is not shown.
    """
    if isinstance(exc, ValueError) and not isinstance(exc, ValidationError):
        return str(exc)
    return f"{type(exc).__name__}: processing failed; inspect the stage and retry"


app = create_app()
