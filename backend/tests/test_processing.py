import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from pypdf import PdfWriter

from invoice_processing.cli import main
from invoice_processing.comparator import compare_invoice
from invoice_processing.docling_reader import document_blocks, validate_pdf
from invoice_processing.extractor import check_grounding, extract_invoice
from invoice_processing.schemas import Extraction, MasterSnapshot, ParsedDocument

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def extraction():
    return Extraction.model_validate_json((FIXTURES / "extraction.json").read_text())


@pytest.fixture
def master():
    return MasterSnapshot.model_validate_json((FIXTURES / "master.json").read_text())


@pytest.fixture
def document():
    return ParsedDocument.model_validate_json((FIXTURES / "document.json").read_text())


def codes(extraction, master):
    return {issue.code for issue in compare_invoice(extraction, master).issues}


def test_exact_match_and_decimal_serialization(extraction, master):
    result = compare_invoice(extraction, master)
    assert result.status == "matched"
    assert result.issues == []
    assert len(result.master_snapshot_hash) == 64
    assert json.loads(master.model_dump_json())["invoices"][0]["subtotal"] == "25.00"


def test_price_mismatch_has_row_and_evidence(extraction, master):
    extraction.invoice.lines[0].unit_price.value = "12.50"
    result = compare_invoice(extraction, master)
    issue = next(issue for issue in result.issues if issue.code == "UNIT_PRICE_MISMATCH")
    assert issue.master_row_id == "row-1"
    assert issue.master_value == "10.00"
    assert issue.evidence[0].block_id == "#/tables/0"
    assert result.status == "needs_review"
    assert "LINE_ARITHMETIC" in codes(extraction, master)


def test_reordered_lines_match_by_sku(extraction, master):
    extraction.invoice.lines.reverse()
    assert compare_invoice(extraction, master).status == "matched"


def test_missing_and_extra_lines(extraction, master):
    extraction.invoice.lines[0].sku.value = "UNKNOWN"
    assert {"EXTRA_INVOICE_LINE", "MISSING_INVOICE_LINE"} <= codes(extraction, master)


def test_repeated_sku_never_chooses_first(extraction, master):
    extraction.invoice.lines.append(extraction.invoice.lines[0].model_copy(deep=True))
    assert "AMBIGUOUS_LINE" in codes(extraction, master)


@pytest.mark.parametrize(
    "value", [None, "", "NaN", "Infinity", "-1", "1,200.00", "1e30", "0.00000001"]
)
def test_invalid_number_requires_review(extraction, master, value):
    extraction.invoice.lines[0].quantity.value = value
    assert "MISSING_OR_INVALID_NUMBER" in codes(extraction, master)


def test_missing_discount_is_not_invented(extraction, master):
    extraction.invoice.lines[0].discount.value = None
    assert compare_invoice(extraction, master).status == "needs_review"


def test_units_are_not_silently_converted(extraction, master):
    extraction.invoice.lines[0].unit.value = "carton"
    assert "UNIT_MISMATCH" in codes(extraction, master)


def test_unknown_supplier_and_duplicate_reference(extraction, master):
    extraction.invoice.supplier_id.value = "other"
    assert compare_invoice(extraction, master).status == "unable_to_verify"
    extraction.invoice.supplier_id.value = master.invoices[0].supplier_id
    master.invoices.append(master.invoices[0].model_copy(deep=True))
    assert "AMBIGUOUS_MASTER" in codes(extraction, master)


def test_currency_is_not_converted(extraction, master):
    extraction.invoice.currency.value = "USD"
    assert "CURRENCY_MISMATCH" in codes(extraction, master)
    extraction.invoice.currency.value = "JPY"
    assert compare_invoice(extraction, master).status == "unable_to_verify"


def test_reference_arithmetic_is_checked(extraction, master):
    master.invoices[0].grand_total = Decimal("100")
    assert compare_invoice(extraction, master).status == "unable_to_verify"
    assert "INVALID_MASTER_TOTALS" in codes(extraction, master)


def test_credit_note_is_not_accepted_as_invoice(extraction, master):
    extraction.invoice.document_type = "credit_note"
    assert compare_invoice(extraction, master).status == "unable_to_verify"


def test_model_warning_prevents_match(extraction, master):
    extraction.invoice.warnings.append("Unclear line on page 2")
    assert compare_invoice(extraction, master).status == "needs_review"


def test_grounding_validates_quotes_and_block_ids(extraction, document):
    assert check_grounding(extraction.invoice, document) == []
    field = extraction.invoice.lines[0].unit_price
    field.evidence[0].quote = "a fabricated quote"
    assert check_grounding(extraction.invoice, document)
    field.evidence[0].quote = "10.00"
    field.evidence[0].block_id = "#/missing/0"
    assert check_grounding(extraction.invoice, document)


def test_missing_grounding_prevents_match(extraction, master):
    extraction.invoice.grand_total.evidence = []
    assert "MISSING_EVIDENCE" in codes(extraction, master)


def test_openai_request_and_grounding(document, extraction):
    client = Mock()
    client.responses.parse.return_value = SimpleNamespace(
        status="completed",
        output_parsed=extraction.invoice,
        model="test-model-1",
        id="resp_test",
    )
    result = extract_invoice(document, model="test-model", client=client)
    request = client.responses.parse.call_args.kwargs
    assert request["store"] is False
    assert "tools" not in request
    assert result.model == "test-model-1"
    assert result.grounding_issues == []
    assert "#/tables/0" in request["input"][1]["content"]


@pytest.mark.parametrize("status,parsed", [("incomplete", None), ("completed", None)])
def test_incomplete_or_refused_response_fails(document, status, parsed):
    client = Mock()
    client.responses.parse.return_value = SimpleNamespace(status=status, output_parsed=parsed)
    with pytest.raises(ValueError, match="incomplete or refused"):
        extract_invoice(document, model="test", client=client)


def test_oversize_model_input_is_not_truncated(document):
    document.blocks[0].text = "x" * 200_001
    client = Mock()
    with pytest.raises(ValueError, match="limit"):
        extract_invoice(document, model="test", client=client)
    client.responses.parse.assert_not_called()


@pytest.mark.parametrize("value", [1.2, "NaN", "-2", "Infinity", "1e40", "abc"])
def test_bad_master_decimals_are_rejected(master, value):
    data = master.model_dump()
    data["invoices"][0]["subtotal"] = value
    with pytest.raises(ValidationError):
        MasterSnapshot.model_validate(data)


def test_pdf_validation(tmp_path):
    path = tmp_path / "invented.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=400)
    writer.write(path)
    fingerprint, pages = validate_pdf(path)
    assert len(fingerprint) == 64 and pages == 1
    writer.encrypt("test")
    writer.write(path)
    with pytest.raises(ValueError, match="Encrypted"):
        validate_pdf(path)
    path.write_bytes(b"not a PDF")
    with pytest.raises(ValueError, match="signature"):
        validate_pdf(path)


def test_page_limit(tmp_path):
    path = tmp_path / "invented.pdf"
    writer = PdfWriter()
    for _ in range(31):
        writer.add_blank_page(width=300, height=400)
    writer.write(path)
    with pytest.raises(ValueError, match="1–30"):
        validate_pdf(path)


def test_docling_table_provenance_adapter():
    bbox = Mock()
    bbox.model_dump.return_value = {"l": 1, "t": 2, "r": 3, "b": 4, "coord_origin": "TOPLEFT"}
    table = SimpleNamespace(
        label="table",
        self_ref="#/tables/0",
        export_to_markdown=lambda **kwargs: "| SKU | Price |\n| X | 10 |",
        prov=[SimpleNamespace(page_no=2, bbox=bbox)],
    )
    document = SimpleNamespace(
        iterate_items=lambda: [(table, 0)],
        pages={2: SimpleNamespace(size=SimpleNamespace(width=100, height=200))},
    )
    blocks = document_blocks(document)
    assert blocks[0].id == "#/tables/0"
    assert blocks[0].locations[0].page == 2
    assert blocks[0].locations[0].bbox["coord_origin"] == "TOPLEFT"


def test_compare_cli_without_models(tmp_path, monkeypatch):
    target = tmp_path / "comparison.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "invoice-process",
            "compare",
            str(FIXTURES / "extraction.json"),
            "--master",
            str(FIXTURES / "master.json"),
            "--out",
            str(target),
        ],
    )
    assert main() == 0
    assert json.loads(target.read_text())["status"] == "matched"
