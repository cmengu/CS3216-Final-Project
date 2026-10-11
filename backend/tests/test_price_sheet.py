import json
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook

from check import load_price_sheet

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


def test_dummy_sheet_matches_the_catalogue_and_its_fingerprint():
    manifest = json.loads((DATA / "manifest.json").read_text())
    sheet = load_price_sheet(DATA / "price-sheet.xlsx")
    assert sheet.version == manifest["price_sheet_sha256"]
    assert sheet.lookup(" res-0603-10k").part_number == "RES-0603-10K"
    for row in manifest["catalog"]:
        found = sheet.lookup(row["part_number"])
        assert found is not None
        assert found.unit_price == Decimal(row["unit_price"])
        assert found.currency == row["currency"]
        assert found.description == row["description"]


def test_missing_header_names_the_column(tmp_path):
    path = tmp_path / "prices.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.title = "Prices"
    sheet.append(["part_number", "description", "unit_price"])
    book.save(path)
    with pytest.raises(ValueError, match="currency"):
        load_price_sheet(path)


def test_a_sheet_with_a_title_above_its_header_and_its_own_wording_loads(tmp_path):
    sheet = load_price_sheet(
        _book(
            tmp_path,
            ["Agreed prices 2026"],
            [],
            [
                "Supplier",
                "Item / part code",
                "Description",
                "Unit",
                "Currency",
                "Agreed unit price",
            ],
            ["Invented Tools", "ABC-1", "Socket", "PC", "SGD", 43.75],
            ["Invented Steel", "ABC-2", "Elbow", "EA", "USD", "1,250.00"],
            title="Master prices",
        )
    )
    assert sheet.lookup("abc-1").unit_price == Decimal("43.75")
    assert sheet.lookup("ABC-2").unit_price == Decimal("1250.00")
    assert sheet.lookup("ABC-2").currency == "USD"
    assert sheet.conflicts == frozenset()


def test_a_sheet_with_no_header_row_is_refused(tmp_path):
    with pytest.raises(ValueError, match="no header row"):
        load_price_sheet(_book(tmp_path, ["Agreed prices 2026"], ["ABC-1", "Socket", "SGD", 1]))


def test_a_missing_file_is_named(tmp_path):
    with pytest.raises(ValueError, match="not found"):
        load_price_sheet(tmp_path / "absent.xlsx")


def test_the_same_part_at_two_prices_is_marked_and_at_one_price_is_not(tmp_path):
    sheet = load_price_sheet(
        _book(
            tmp_path,
            HEADER,
            ["ABC-1", "Socket", "SGD", 43.75],
            ["abc-1 ", "Socket", "SGD", 44.75],
            ["ABC-2", "Elbow", "USD", 1.9],
            ["ABC-2", "Elbow", "usd", 1.9],
        )
    )
    assert sheet.has_conflict("ABC-1")
    assert not sheet.has_conflict("ABC-2")


def test_a_price_that_is_not_a_number_names_its_row(tmp_path):
    for bad in ("0,0047", "call us", None, -1):
        with pytest.raises(ValueError, match="row 2"):
            load_price_sheet(_book(tmp_path, HEADER, ["ABC-1", "Socket", "SGD", bad]))


def test_a_very_small_price_keeps_plain_digits(tmp_path):
    sheet = load_price_sheet(_book(tmp_path, HEADER, ["ABC-1", "Socket", "SGD", 0.00005]))
    assert sheet.lookup("ABC-1").unit_price_text == "0.00005"


HEADER = ["part_number", "description", "currency", "unit_price"]


def _book(tmp_path, *rows, title="Sheet1"):
    path = tmp_path / "prices.xlsx"
    book = Workbook()
    book.active.title = title
    for row in rows:
        book.active.append(row)
    book.save(path)
    return path
