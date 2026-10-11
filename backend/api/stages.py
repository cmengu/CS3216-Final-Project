"""Swap these adapters when Chen Meng/Kalent supply their functions; no hidden mock fallback."""

import hashlib
import json
from pathlib import Path
from typing import Protocol

from read.models import ParsedDocument
from schema import InvoiceRecord

from .contracts import CheckResult


class Stages(Protocol):
    mode: str
    price_sheet_version: str

    def extract(self, document: ParsedDocument) -> InvoiceRecord: ...
    def check(self, invoice: InvoiceRecord) -> CheckResult: ...


class FixtureStages:
    """Replays known answers ONLY for exact generated PDF hashes. Not an AI or price checker."""

    mode = "fixture"

    def __init__(self, directory: Path):
        manifest = json.loads((directory / "manifest.json").read_text())
        self.price_sheet_version = manifest["price_sheet_sha256"]
        sheet = directory / "price-sheet.xlsx"
        if hashlib.sha256(sheet.read_bytes()).hexdigest() != self.price_sheet_version:
            raise ValueError("Fixture price sheet changed; regenerate the dummy manifest")
        self.cases = {case["id"]: case for case in manifest["cases"]}
        self.hashes = {file["sha256"]: case for case in manifest["cases"] for file in case["files"]}

    def extract(self, document: ParsedDocument) -> InvoiceRecord:
        case = self.hashes.get(document.document_hash)
        if case is None:
            raise ValueError(
                "Fixture mode accepts only PDFs registered in data/dummy/manifest.json"
            )
        return InvoiceRecord.model_validate(case["invoice"])

    def check(self, invoice: InvoiceRecord) -> CheckResult:
        matches = [case for case in self.cases.values() if case["invoice"] == invoice.model_dump()]
        if len(matches) != 1:
            raise ValueError("No exact fixture record; refusing to fabricate a check result")
        return CheckResult.model_validate(
            {
                **matches[0]["expected_check"],
                "price_sheet_version": self.price_sheet_version,
            }
        )
