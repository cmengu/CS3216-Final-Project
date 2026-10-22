"""Persistent, immutable master-list versions used by invoice checks."""

import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile

from .master_import import normalize, preview, read_tables
from .storage import now

router = APIRouter(prefix="/master-list")
MAX_UPLOAD = 5 * 1024 * 1024


def initialize(store):
    with store.connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS master_lists (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL,
            event TEXT NOT NULL, source BLOB NOT NULL
        )""")


def read_upload(file):
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if filename.lower().rsplit(".", 1)[-1] not in ("csv", "xlsx", "xls"):
        raise HTTPException(415, "Upload a CSV or Excel (.xlsx or .xls) file")
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File exceeds 5 MB")
    try:
        tables = read_tables(filename, data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            422,
            "Could not read this file. Check that it is a valid, unencrypted CSV or Excel workbook.",
        ) from exc
    return filename, data, tables


@router.get("")
def current(request: Request):
    return current_master(request.app.state.store)


def current_master(store, version=None):
    with store.connect() as db:
        if version is None:
            row = db.execute(
                "SELECT document FROM master_lists ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
        else:
            row = db.execute(
                "SELECT document FROM master_lists WHERE json_extract(document, '$.version') = ? "
                "ORDER BY rowid DESC LIMIT 1",
                (version,),
            ).fetchone()
    return json.loads(row["document"]) if row else None


@router.get("/versions/{version}")
def historical(version: str, request: Request):
    document = current_master(request.app.state.store, version)
    if document is None:
        raise HTTPException(404, "The master list used for this check is unavailable.")
    return document


@router.get("/events")
def events(request: Request):
    with request.app.state.store.connect() as db:
        rows = db.execute("SELECT event FROM master_lists ORDER BY rowid DESC").fetchall()
    return [json.loads(row["event"]) for row in rows]


@router.post("/preview")
def inspect(file: UploadFile):
    try:
        _, _, tables = read_upload(file)
        return preview(tables)
    finally:
        file.file.close()


@router.post("", status_code=201)
@router.put("")
def upload(request: Request, file: UploadFile, options: str = Form("{}")):
    try:
        filename, data, tables = read_upload(file)
        try:
            selection = json.loads(options)
            if not isinstance(selection, dict) or set(selection) - {"sheet", "header", "mapping"}:
                raise ValueError("Invalid import options")
            if "header" in selection and type(selection["header"]) is not int:
                raise ValueError("Header must be a row number")
            if "mapping" in selection and not isinstance(selection["mapping"], dict):
                raise ValueError("Column mapping must be an object")
            if "sheet" in selection and not isinstance(selection["sheet"], str):
                raise ValueError("Worksheet name must be text")
            items = normalize(tables, **selection)
        except (ValueError, TypeError, StopIteration) as exc:
            raise HTTPException(422, str(exc) or "Invalid worksheet selection") from exc
        timestamp = now()
        document = {
            "id": str(uuid4()),
            "version": hashlib.sha256(
                data + json.dumps({"selection": selection, "items": items}, sort_keys=True).encode()
            ).hexdigest(),
            "file": filename,
            "uploadedAt": timestamp,
            "items": items,
            "supplierCount": len({i["supplier"] for i in items if i["supplier"]}),
        }
        with request.app.state.store.connect() as db:
            # Serialize replacement events and the active-version order in a single transaction.
            db.execute("BEGIN IMMEDIATE")
            exists = db.execute("SELECT 1 FROM master_lists LIMIT 1").fetchone()
            if request.method == "POST" and exists:
                raise HTTPException(409, "A master list already exists. Use Replace file.")
            if request.method == "PUT" and not exists:
                raise HTTPException(409, "No master list exists yet. Upload one first.")
            event = {
                "kind": "replaced" if exists else "uploaded",
                "file": filename,
                "at": timestamp,
                "items": len(items),
                "suppliers": document["supplierCount"],
            }
            db.execute(
                "INSERT INTO master_lists VALUES (?,?,?,?,?)",
                (document["id"], timestamp, json.dumps(document), json.dumps(event), data),
            )
        return document
    finally:
        file.file.close()
