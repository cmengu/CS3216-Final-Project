"""Read the agreed prices from the Excel file. One price per part."""

import hashlib
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from itertools import chain, islice
from pathlib import Path

from openpyxl import load_workbook

# The four columns the check needs, each with the header wordings it accepts. Headers are
# compared in lower case with punctuation read as spaces, so "part_number" is "part number".
# Add the client's own wording here when its sheet arrives; every other column is ignored.
HEADERS = {
    "part_number": (
        "part number",
        "part no",
        "part code",
        "item code",
        "item part code",
        "stock code",
        "product code",
    ),
    "description": ("description",),
    "currency": ("currency",),
    "unit_price": ("unit price", "agreed unit price", "agreed price", "price"),
}
# A real sheet often has a title and notes above its header row.
HEADER_SEARCH_ROWS = 20
THOUSANDS = re.compile(r"-?\d{1,3}(,\d{3})+(\.\d+)?")


@dataclass(frozen=True)
class SheetPrice:
    part_number: str
    description: str
    currency: str
    unit_price: Decimal
    unit_price_text: str


@dataclass(frozen=True)
class PriceSheet:
    version: str
    prices: dict[str, SheetPrice]
    # Parts the sheet lists more than once with different prices. The check sends them to a
    # person, because no rule yet says which row applies.
    conflicts: frozenset[str] = field(default_factory=frozenset)

    def lookup(self, part_number: str | None) -> SheetPrice | None:
        return self.prices.get(_key(part_number))

    def has_conflict(self, part_number: str | None) -> bool:
        return _key(part_number) in self.conflicts


def load_price_sheet(path: Path) -> PriceSheet:
    file = Path(path)
    if not file.is_file():
        raise ValueError(f"Price sheet not found: {file}")
    version = hashlib.sha256(file.read_bytes()).hexdigest()
    workbook = load_workbook(file, data_only=False, read_only=True)
    try:
        rows = workbook.worksheets[0].iter_rows(values_only=True)
        head = list(islice(rows, HEADER_SEARCH_ROWS))
        header_at, columns = _header(head)
        prices: dict[str, SheetPrice] = {}
        conflicts: set[str] = set()
        body = chain(head[header_at + 1 :], rows)
        for row_number, row in enumerate(body, start=header_at + 2):
            price = _price(row, columns, row_number)
            if price is None:
                continue
            key = _key(price.part_number)
            first = prices.setdefault(key, price)
            if (first.unit_price, _fold(first.currency)) != (
                price.unit_price,
                _fold(price.currency),
            ):
                conflicts.add(key)
    finally:
        workbook.close()
    return PriceSheet(version=version, prices=prices, conflicts=frozenset(conflicts))


def _header(head) -> tuple[int, dict[str, int]]:
    """The row holding the most known headers, and where each of the four columns sits."""
    best_at, best = 0, {}
    for index, row in enumerate(head):
        found = _columns(row)
        if len(found) > len(best):
            best_at, best = index, found
    if not best:
        raise ValueError("Price sheet has no header row")
    missing = [name for name in HEADERS if name not in best]
    if missing:
        raise ValueError(f"Price sheet is missing the {missing[0]} column")
    return best_at, best


def _columns(row) -> dict[str, int]:
    found = {}
    for index, value in enumerate(row):
        name = re.sub(r"[^a-z0-9]+", " ", _text(value).casefold()).strip()
        for column, wordings in HEADERS.items():
            if name in wordings and column not in found:
                found[column] = index
    return found


def _price(row, columns: dict[str, int], row_number: int) -> SheetPrice | None:
    part = _text(_cell(row, columns["part_number"]))
    if not part:
        return None
    amount, text = _decimal(_cell(row, columns["unit_price"]), row_number)
    return SheetPrice(
        part_number=part,
        description=_text(_cell(row, columns["description"])),
        currency=_text(_cell(row, columns["currency"])),
        unit_price=amount,
        unit_price_text=text,
    )


def _cell(row, index: int):
    if index >= len(row):
        return None
    return row[index]


def _text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _fold(value: str) -> str:
    return value.strip().casefold()


def _key(part_number: str | None) -> str:
    return _fold(_text(part_number))


def _decimal(value, row_number: int) -> tuple[Decimal, str]:
    problem = f"Price sheet row {row_number} has a unit price that is not a number"
    if isinstance(value, bool) or value is None:
        raise ValueError(problem)
    text = str(value).strip()
    if isinstance(value, str) and THOUSANDS.fullmatch(text):
        text = text.replace(",", "")
    try:
        amount = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(problem) from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError(problem)
    # Plain digits, never "5E-5": the check result carries this text.
    return amount, format(amount, "f")
