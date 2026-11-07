"""Full-sheet evidence and semantic gates, without sending real data to a model."""

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from api.master_import import normalize, preview
from api.master_mapping import (
    Column,
    Layout,
    Layouts,
    SheetUnderstanding,
    Understanding,
    suggest_layouts,
)
from api.master_profile import build_payload, heading, sampled_indices


def receipts(count=150):
    return [
        ["Mã khách", "Tên khách hàng", "Mã vật tư", "Tên vật tư", "Đvt", "Số lượng", "Giá", "Tiền"]
    ] + [
        [
            f"KH{i % 3}",
            f"Supplier {i % 3}",
            f"SKU-{i}",
            f"Product {i}",
            "cái",
            str(i + 2),
            "12.50",
            str((i + 2) * 12.5),
        ]
        for i in range(count)
    ]


def understanding():
    return Understanding(
        sheets=[
            SheetUnderstanding(
                sheet=0,
                kind="goods_receipts",
                observations="Columns 2/3 identify items; 5 × 6 = 7. Receipt history may repeat items; confirm prices.",
            )
        ]
    )


def mapping(price=6, header=0):
    return Layouts(
        sheets=[
            Layout(
                sheet=0,
                header=header,
                columns=[
                    Column(field="name", column=3),
                    Column(field="item", column=2),
                    Column(field="supplier", column=1),
                    Column(field="quantity", column=5),
                    Column(field="unit", column=4),
                    Column(field="price", column=price),
                ],
                note="",
            )
        ]
    )


def client(*answers):
    parse = Mock(
        side_effect=[SimpleNamespace(status="completed", output_parsed=value) for value in answers]
    )
    return SimpleNamespace(responses=SimpleNamespace(parse=parse))


def test_full_sheet_stratified_samples_are_reproducible_and_preserve_indices():
    rows = receipts()
    indices = sampled_indices(rows, start=1)
    assert len(indices) == len(set(indices)) == 10
    assert indices == sampled_indices(rows, start=1)
    assert indices[0] == 1 and indices[-1] == 150
    assert len([i for i in indices if i > 50]) >= 6
    evidence = json.loads(build_payload([{"name": "T1", "rows": rows}]))[0]
    assert evidence["row_count"] == 151
    assert [row["row_index"] for row in evidence["sample_rows"]] == indices
    assert evidence["sample_rows"][-1]["cells"]["3"] == "Product 149"
    assert {"factors": [5, 6], "total": 7, "supporting_rows": 10} in evidence[
        "multiplication_relations"
    ]
    assert evidence["column_profiles"][6]["numeric"] == 10


def test_sampling_small_sparse_sheet_keeps_source_row_numbers():
    rows = [["Name", "Price"], [], [""], ["Bolt", "2"], [], ["Nut", "3"]]
    assert sampled_indices(rows, start=1) == [3, 5]


def test_late_header_remains_visible_in_source_context():
    rows = [[f"Report note {i}"] for i in range(40)] + receipts(10)
    evidence = json.loads(build_payload([{"name": "T1", "rows": rows}]))[0]
    assert any(
        row["row_index"] == 40 and row["cells"]["3"] == "Tên vật tư"
        for row in evidence["non_empty_rows"]
    )
    assert all(row["row_index"] > 40 for row in evidence["sample_rows"])


def test_late_unfamiliar_language_header_uses_data_types_not_a_dictionary():
    rows = [[f"Note {i}"] for i in range(40)] + [
        ["Désignation", "Prix unitaire", "Quantité"],
        ["Boulon", "1.25", "8"],
    ]
    evidence = json.loads(build_payload([{"name": "Catalogue", "rows": rows}]))[0]
    assert any(row["row_index"] == 40 for row in evidence["non_empty_rows"])


def test_explore_precedes_mapping_with_one_shared_timeout_and_receipt_warning():
    rows = receipts()
    original = [row[:] for row in rows]
    model = client(understanding(), mapping())
    result = suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")
    calls = model.responses.parse.call_args_list
    assert [call.kwargs["text_format"] for call in calls] == [Understanding, Layouts]
    assert 0 < calls[1].kwargs["timeout"] <= calls[0].kwargs["timeout"] <= 45
    payload = json.loads(calls[1].kwargs["input"][1]["content"])
    assert payload["data_exploration"]["sheets"][0]["kind"] == "goods_receipts"
    assert payload["source_evidence"][0]["sample_rows"][-1]["row_index"] == 150
    assert "untrusted" in calls[0].kwargs["input"][0]["content"]
    assert "goods-receipt history" in result.sheets[0].note
    assert rows == original


def test_extended_amount_gets_one_repair_instead_of_becoming_unit_price():
    model = client(understanding(), mapping(price=7), mapping())
    result = suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")
    assert next(c.column for c in result.sheets[0].columns if c.field == "price") == 6
    assert model.responses.parse.call_count == 3
    repair = model.responses.parse.call_args.kwargs["input"][1]["content"]
    assert "unit rate" in repair and "sampled arithmetic" in repair


def test_invalid_repair_is_never_returned_as_an_ai_mapping():
    model = client(understanding(), mapping(price=7), mapping(price=7))
    with pytest.raises(ValueError, match="needs review"):
        suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")
    assert model.responses.parse.call_count == 3


def test_row_identifier_is_not_accepted_as_quantity():
    rows = receipts()
    rows[0][0] = "STT"
    for i, row in enumerate(rows[1:]):
        row[0] = str(i + 1)
    bad = mapping()
    next(c for c in bad.sheets[0].columns if c.field == "quantity").column = 0
    model = client(understanding(), bad, bad)
    with pytest.raises(ValueError, match="identifier"):
        suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")


@pytest.mark.parametrize("field,column", [("po", 2), ("description", 7)])
def test_missing_optional_fields_cannot_be_replaced_by_codes_or_amounts(field, column):
    bad = mapping()
    bad.sheets[0].columns.append(Column(field=field, column=column))
    model = client(understanding(), bad, bad)
    with pytest.raises(ValueError, match="needs review"):
        suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")


@pytest.mark.parametrize(
    "label",
    ["Mã nx", "Mã kho", "Mã dự án", "Account code", "Warehouse code", "Receipt date", "Diễn giải"],
)
def test_accounting_metadata_is_never_a_purchase_order(label):
    rows = receipts()
    rows[0].append(label)
    for row in rows[1:]:
        row.append("331111")
    bad = mapping()
    bad.sheets[0].columns.append(Column(field="po", column=8))
    model = client(understanding(), bad, mapping())
    result = suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")
    assert all(c.field != "po" for c in result.sheets[0].columns)
    assert model.responses.parse.call_count == 3


def test_receipt_memo_cannot_replace_product_description():
    rows = receipts()
    rows[0].append("Diễn giải")
    for row in rows[1:]:
        row.append("Receipt for warehouse stock")
    bad = mapping()
    bad.sheets[0].columns.append(Column(field="description", column=8))
    model = client(understanding(), bad, mapping())
    result = suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")
    assert all(c.field != "description" for c in result.sheets[0].columns)


def test_real_purchase_order_reference_is_preserved():
    rows = receipts()
    rows[0].append("PO reference")
    for row in rows[1:]:
        row.append("PO-2026-123")
    proposed = mapping()
    proposed.sheets[0].columns.append(Column(field="po", column=8))
    model = client(understanding(), proposed)
    result = suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")
    assert next(c.column for c in result.sheets[0].columns if c.field == "po") == 8


@pytest.mark.parametrize("field", ["item", "unit", "quantity"])
def test_repair_cannot_drop_explicit_populated_source_constraints(field):
    reduced = mapping()
    reduced.sheets[0].columns = [c for c in reduced.sheets[0].columns if c.field != field]
    model = client(understanding(), reduced, reduced)
    with pytest.raises(ValueError, match="Preserve this source constraint"):
        suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")


def test_numeric_identifier_is_not_accepted_as_price():
    rows = receipts()
    for i, row in enumerate(rows[1:]):
        row[0] = str(1000 + i)
    model = client(understanding(), mapping(price=0), mapping(price=0))
    with pytest.raises(ValueError, match="not a unit rate"):
        suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")


def test_numeric_gate_examines_rows_beyond_the_ui_preview():
    rows = receipts()
    for row in rows[51:]:
        row[6] = "ask supplier"
    model = client(understanding(), mapping(), mapping())
    with pytest.raises(ValueError, match="full-sheet samples"):
        suggest_layouts([{"name": "T1", "rows": rows}], client=model, model="test")


def test_invalid_exploration_stops_before_mapping():
    bad = understanding()
    bad.sheets[0].sheet = 4
    model = client(bad, bad)
    with pytest.raises(ValueError, match="exploration.*worksheet"):
        suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")
    assert model.responses.parse.call_count == 2


def test_repaired_exploration_shares_the_three_call_allowance():
    bad = understanding()
    bad.sheets[0].sheet = 1
    model = client(bad, understanding(), mapping())
    result = suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")
    assert model.responses.parse.call_count == 3
    assert result.sheets[0].header == 0


def test_local_oversized_context_falls_back_without_starting_inference(monkeypatch):
    call = Mock(side_effect=AssertionError("Should not query the model"))
    monkeypatch.setattr("extract.local_pipeline._call_ollama_structured", call)
    with pytest.raises(ValueError, match="too large"):
        suggest_layouts(
            [{"name": f"Sheet {i}", "rows": receipts()} for i in range(4)], model="gemma4:e4b"
        )
    call.assert_not_called()


def test_mapping_disables_hidden_local_schema_retries(monkeypatch):
    from extract.local_pipeline import UsageAccumulator, _call_ollama_structured

    request = Mock(return_value={"message": {"content": '{"sheets": []}'}})
    monkeypatch.setattr("extract.local_pipeline.request_ollama", request)
    # Invalid fields fail once; the mapping orchestrator owns the repair budget.
    request.return_value["message"]["content"] = '{"unexpected": true}'
    with pytest.raises(ValueError, match="schema validation"):
        _call_ollama_structured(
            base_url="http://model.test",
            model="test",
            system_prompt="test",
            user_prompt="synthetic",
            schema_type=Understanding,
            tracker=UsageAccumulator(model="test"),
            retry_invalid_output=False,
        )
    request.assert_called_once()


def test_exhausted_deadline_prevents_another_model_call(monkeypatch):
    now = [0.0]
    monkeypatch.setattr("api.master_mapping.time.monotonic", lambda: now[0])

    def respond(**kwargs):
        now[0] = 46
        return SimpleNamespace(status="completed", output_parsed=understanding())

    model = SimpleNamespace(responses=SimpleNamespace(parse=Mock(side_effect=respond)))
    with pytest.raises(ValueError, match="timed out"):
        suggest_layouts([{"name": "T1", "rows": receipts()}], client=model, model="test")
    assert model.responses.parse.call_count == 1


def test_preview_profiles_full_table_but_returns_only_fifty_rows(monkeypatch):
    rows = receipts()

    def suggest(sheets):
        assert sheets[0]["rows"][-1] == rows[-1]
        return mapping()

    monkeypatch.setattr("api.master_import.suggest_layouts", suggest)
    result = preview({"T1": rows})["sheets"][0]
    assert result["rows"] == rows[:50]
    assert result["mappingSource"] == "ai"
    assert result["mapping"]["price"] == 6


def test_vietnamese_fallback_and_import_preserve_cell_values(monkeypatch):
    def unavailable(*args):
        raise ValueError("AI mapping is unavailable")

    monkeypatch.setattr("api.master_import.suggest_layouts", unavailable)
    rows = receipts(3)
    result = preview({"T1": rows})["sheets"][0]
    assert result["mappingSource"] == "manual"
    assert result["mapping"] == {"name": 3, "price": 6, "quantity": 5, "item": 2, "unit": 4}
    assert heading("Đơn giá") == heading("Đơn giá") == "don gia"
    items = normalize({"T1": rows}, "T1", 0, result["mapping"])
    assert items[0]["price"] == rows[1][6]
    assert items[0]["quantity"] == rows[1][5]
    assert items[0]["name"] == rows[1][3]


def test_model_omitted_optional_scope_stays_omitted(monkeypatch):
    layout = Layouts(
        sheets=[
            Layout(
                sheet=0,
                header=0,
                columns=[Column(field="name", column=0), Column(field="price", column=1)],
                note="Supplier scope is uncertain",
            )
        ]
    )
    monkeypatch.setattr("api.master_import.suggest_layouts", lambda _: layout)
    result = preview({"Sheet": [["Name", "Price", "Supplier"], ["Bolt", "2", "Customer name"]]})[
        "sheets"
    ][0]
    assert "supplier" not in result["mapping"]


def test_payload_limit_rejects_before_any_model_request():
    rows = [[f"Heading {i}" for i in range(100)]] + [
        ["Long source value " * 20] * 100 for _ in range(20)
    ]
    model = client()
    with pytest.raises(ValueError, match="too large"):
        suggest_layouts(
            [{"name": f"Sheet {i}", "rows": rows} for i in range(3)], client=model, model="test"
        )
    model.responses.parse.assert_not_called()
