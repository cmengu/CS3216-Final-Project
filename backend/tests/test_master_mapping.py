from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from api.master_import import normalize, preview
from api.master_mapping import Column, Layout, Layouts, suggest_layouts

SHEETS = [
    {
        "name": "Catalogue",
        "rows": [["Tarifs"], ["Désignation", "Prix unitaire", "Quantité"], ["Boulon", "1.25", "8"]],
    }
]


def fake_client(header=1, columns=None, status="completed"):
    parsed = Layouts(
        sheets=[
            Layout(
                sheet=0,
                header=header,
                columns=columns
                if columns is not None
                else [
                    Column(field="name", column=0),
                    Column(field="price", column=1),
                    Column(field="quantity", column=2),
                ],
                note="Review the proposed mapping",
            )
        ]
    )
    parse = Mock(return_value=SimpleNamespace(status=status, output_parsed=parsed))
    return SimpleNamespace(responses=SimpleNamespace(parse=parse))


def test_structured_request_and_multilingual_response():
    client = fake_client()
    result = suggest_layouts(SHEETS, client=client, model="configured-model")
    assert result.sheets[0].header == 1
    assert result.sheets[0].columns[1].field == "price"
    request = client.responses.parse.call_args.kwargs
    assert request["model"] == "configured-model"
    assert request["store"] is False
    assert request["text_format"] is Layouts
    assert "Désignation" in request["input"][1]["content"]
    assert "untrusted data" in request["input"][0]["content"]


@pytest.mark.parametrize(
    "header,columns",
    [
        (999, []),
        (-1, []),
        (1, [Column(field="name", column=100)]),
        (1, [Column(field="name", column=0), Column(field="name", column=1)]),
        (1, [Column(field="name", column=0), Column(field="price", column=0)]),
        (None, [Column(field="name", column=0)]),
    ],
)
def test_invalid_model_indices_rejected(header, columns):
    with pytest.raises(ValueError):
        suggest_layouts(SHEETS, client=fake_client(header, columns), model="test")


def test_refusal_and_missing_worksheets():
    with pytest.raises(ValueError, match="incomplete"):
        suggest_layouts(SHEETS, client=fake_client(status="incomplete"), model="test")
    with pytest.raises(ValueError, match="worksheet"):
        suggest_layouts(SHEETS * 2, client=fake_client(), model="test")


def test_manual_fallback_preserves_source(monkeypatch):
    def unavailable(*args):
        raise ValueError("AI unavailable; select columns manually")

    monkeypatch.setattr("api.master_import.suggest_layouts", unavailable)
    tables = {"Catalogue": SHEETS[0]["rows"]}
    result = preview(tables)["sheets"][0]
    assert result["mapping"] == {}
    assert result["mappingSource"] == "manual"
    assert result["rows"] == SHEETS[0]["rows"]
    assert "unavailable" in result["note"]
    # Confirmed mappings never re-run the LLM or allow it to change cell values.
    items = normalize(tables, "Catalogue", 1, {"name": 0, "price": 1, "quantity": 2})
    assert items[0]["name"] == "Boulon"
    assert items[0]["price"] == "1.25"
    assert items[0]["quantity"] == "8"


def test_preview_applies_llm_header_and_columns(monkeypatch):
    monkeypatch.setattr(
        "api.master_import.suggest_layouts",
        lambda sheets: suggest_layouts(sheets, client=fake_client(), model="test"),
    )
    result = preview({"Catalogue": SHEETS[0]["rows"]})["sheets"][0]
    assert result["header"] == 1
    assert result["mapping"] == {"name": 0, "price": 1, "quantity": 2}
    assert result["mappingSource"] == "ai"


def test_no_api_key_keeps_manual_path(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = preview({"Catalogue": SHEETS[0]["rows"]})["sheets"][0]
    assert result["mappingSource"] == "manual"
    assert "not configured" in result["note"]


@pytest.mark.parametrize(
    "names,expected", [(["Description"], 0), (["Description", "Item name"], None)]
)
def test_preview_fills_only_unambiguous_missing_name(monkeypatch, names, expected):
    columns = names + ["Agreed unit price"]
    layout = Layouts(
        sheets=[
            Layout(
                sheet=0,
                header=0,
                columns=[Column(field="price", column=len(names))],
                note="",
            )
        ]
    )
    monkeypatch.setattr("api.master_import.suggest_layouts", lambda sheets: layout)
    result = preview({"Prices": [columns, ["Sample"] * len(names) + ["12.50"]]})["sheets"][0]
    assert result["mapping"].get("name") == expected
    assert result["mapping"]["price"] == len(names)


def test_real_workbook_header_fallback_when_ai_unavailable(monkeypatch):
    from pathlib import Path

    from api.master_import import read_tables

    def unavailable(*args):
        raise ValueError("AI mapping is unavailable")

    monkeypatch.setattr("api.master_import.suggest_layouts", unavailable)
    path = Path(__file__).resolve().parents[2] / "data/mock_invoice_dataset/master_pricing.xlsx"
    sheets = preview(read_tables(path.name, path.read_bytes()))["sheets"]
    prices = next(s for s in sheets if s["name"] == "Master prices")
    assert prices["header"] == 5
    assert prices["mapping"]["name"] == 5
    assert prices["mapping"]["price"] == 8
    assert prices["mappingSource"] == "manual"  # Fallback requires user review.
    usage = next(s for s in sheets if s["name"] == "Usage")
    assert usage["mapping"] == {}


def test_header_fallback_does_not_guess_between_tables():
    from api.master_import import fallback_layout

    assert (
        fallback_layout([["Name", "Price"], ["Bolt", "2"], ["Name", "Price"], ["Nut", "3"]]) is None
    )
