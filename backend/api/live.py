"""The real steps behind the service's two slots: a model fills the fields, plain code checks them."""

from pathlib import Path

from check import check, load_price_sheet
from extract import extract as extract_fields
from read.models import ParsedDocument
from schema import InvoiceRecord

from .contracts import CheckResult


class LiveStages:
    """Reads the price sheet once, when the service starts. A changed sheet needs a restart."""

    mode = "live"

    def __init__(self, price_sheet: Path, *, extract=extract_fields):
        self.sheet = load_price_sheet(price_sheet)
        self.price_sheet_version = self.sheet.version
        self._extract = extract

    def extract(self, document: ParsedDocument) -> InvoiceRecord:
        return self._extract(document)

    def check(self, invoice: InvoiceRecord) -> CheckResult:
        return check(invoice, self.sheet)
