"""Upload complete batches, then let durable server jobs check them independently."""

import os
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, UploadFile

from read.reader import MAX_BYTES, validate_pdf
from read.xml_invoice import read_xml_invoice

from .limits import charge_checks, reserve_upload
from .storage import request_session_id
from .uploaded_master import UploadedMasterStages

router = APIRouter(prefix="/invoice-batches")
MAX_BATCH_BYTES = 100 * 1024 * 1024
MAX_BATCH_FILES = 1000


@router.post("", status_code=202)
def upload_batch(request: Request, files: list[UploadFile]):
    store, selected = request.app.state.store, request.app.state.stages
    workspace = request_session_id(request)
    temporary, accepted, duplicates, documents = [], [], [], []
    reserved = 0
    try:
        if not selected:
            raise HTTPException(503, "The checking service is not configured.")
        if not 1 <= len(files) <= MAX_BATCH_FILES:
            raise HTTPException(413, "Upload 1 to 1,000 invoices in one batch.")
        if isinstance(selected, UploadedMasterStages):
            try:
                selected = selected.bind(store, session_id=workspace)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
        version = selected.price_sheet_version
        total_bytes = 0
        seen = set()
        for file in files:
            filename = (file.filename or "invoice.pdf").replace("\\", "/").rsplit("/", 1)[-1]
            is_xml = filename.lower().endswith(".xml")
            if not filename.lower().endswith((".pdf", ".xml")):
                raise HTTPException(
                    415, f"{filename}: upload a PDF or Vietnamese HDon XML invoice."
                )
            if is_xml and selected.mode == "fixture":
                raise HTTPException(422, "XML invoices require live mode and a master list.")
            invoice_id = str(uuid4())
            path = store.path(invoice_id)
            temporary.append((invoice_id, path))
            size = 0
            with path.open("xb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    total_bytes += len(chunk)
                    if size > MAX_BYTES or total_bytes > MAX_BATCH_BYTES:
                        raise HTTPException(
                            413,
                            "Each invoice must be at most 20 MiB; the batch must be at most 100 MiB.",
                        )
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            try:
                if is_xml:
                    document, _ = read_xml_invoice(path.read_bytes(), filename)
                    document_hash = document.document_hash
                else:
                    document_hash, _ = validate_pdf(path)
            except ValueError as exc:
                raise HTTPException(422, f"{filename}: {exc}") from exc
            existing = request.app.state.jobs.existing(workspace, document_hash)
            if existing or document_hash in seen:
                duplicates.append({"filename": filename, "existing_id": existing})
                continue
            seen.add(document_hash)
            documents.append(
                {
                    "id": invoice_id,
                    "filename": filename,
                    "document_hash": document_hash,
                    "mode": selected.mode,
                    "size": size,
                }
            )
        charge_checks(
            request,
            len(documents),
            sum(not item["filename"].lower().endswith(".xml") for item in documents),
        )
        reserved = reserve_upload(request, sum(item["size"] for item in documents))
        batch_id, accepted, raced_duplicates = request.app.state.jobs.enqueue(
            workspace, documents, version
        )
        duplicates.extend(
            {"filename": item["filename"], "existing_id": item["existing_id"]}
            for item in raced_duplicates
        )
        if raced_duplicates:
            amount = sum(item["size"] for item in raced_duplicates)
            request.app.state.limits.release_storage(workspace, amount)
            reserved -= amount
        if request.app.state.worker:
            request.app.state.worker.wake.set()
        return {
            "id": batch_id,
            "invoices": [store.get(invoice_id, session_id=workspace) for invoice_id in accepted],
            "duplicates": duplicates,
            "processing": "background",
        }
    except BaseException:
        if reserved and not accepted:
            request.app.state.limits.release_storage(workspace, reserved)
        raise
    finally:
        for file in files:
            file.file.close()
        for invoice_id, path in temporary:
            if invoice_id not in accepted:
                path.unlink(missing_ok=True)


@router.get("/{batch_id}")
def batch_status(batch_id: str, request: Request):
    status = request.app.state.jobs.batch(batch_id, request_session_id(request))
    if status is None:
        raise HTTPException(404, "Batch not found.")
    return status
