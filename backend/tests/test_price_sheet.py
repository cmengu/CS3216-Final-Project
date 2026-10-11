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
