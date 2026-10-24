"""Unit tests for the decomposed multi-step local LLM pipeline (Step 1 Header, Step 2 Chunked Table, Step 3 Line Verification, Step 4 Surgical Refinement)."""

import json

from extract.context import CheckingInvoice
from extract.invoice import extract_with_usage, refine_with_usage
from extract.local_pipeline import (
    HeaderDraft,
    _extract_candidate_issuer_headings,
    _extract_markdown_tables,
    _group_rows_into_chunks,
    _validate_header_gatekeeper,
    is_local_model,
)
from read.models import ParsedDocument
from schema import InvoiceRecord


def _doc(markdown: str, filename: str = "invoice.pdf") -> ParsedDocument:
    return ParsedDocument(
        document_hash="b" * 64,
        filename=filename,
        page_count=1,
        reader_version="test",
        markdown=markdown,
        blocks=[],
        docling_document={},
    )


def test_is_local_model_detection(monkeypatch):
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    assert is_local_model("qwen3.5:4b") is True
    assert is_local_model("qwen3.5:9b") is True
    assert is_local_model("gpt-5.4-mini") is False
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://100.89.215.68:11434")
    assert is_local_model("custom-model") is True


def test_candidate_issuer_headings_ignores_dummy_data_and_bill_to():
    md = (
        "<!-- Page 1 -->\n"
        "DUMMY DATA\n\n"
        "Invoice number: DEMO-002\n"
        "Bill to: Example Semiconductor Company\n\n"
        "| Part number | Description | Quantity | Unit price | Line total |\n"
        "|---|---|---|---|---|\n"
        "| RES-0603-10K | Resistor | 5000 | 0.015 | 75.00 |\n\n"
        "<!-- image -->\n\n"
        "## Invented Silicon Trading\n"
    )
    headings = _extract_candidate_issuer_headings(md)
    assert headings == ["Invented Silicon Trading"]


def test_table_segmentation_separates_item_tables_from_summary_tables():
    md = (
        "## Demo Circuit Supplies\n\n"
        "| Part number | Description | Quantity | Unit price | Line total |\n"
        "|---|---|---|---|---|\n"
        "| RES-0603-10K | Resistor 10k ohm 0603 | 5000 | 0.012 | 60.00 |\n"
        "| CAP-0402-100N | Ceramic capacitor 100nF 0402 | 10000 | 0.0047 | 47.00 |\n\n"
        "| Subtotal | 107.00 |\n"
        "|---|---|\n"
        "| Tax (9%) | 9.63 |\n"
    )
    tables = _extract_markdown_tables(md)
    assert len(tables) == 2
    assert tables[0].is_summary_table is False
    assert len(tables[0].data_rows) == 2
    assert tables[1].is_summary_table is True


def test_chunking_excludes_footer_total_row_and_splits_large_tables():
    rows = [
        f"| DIO-SCH-40V | Schottky diode 40V | 5000 | 0.032 | 160.00 |"
        for _ in range(14)
    ] + [
        "| | | | Total: | US$2,240.00 |",
    ]
    chunks = _group_rows_into_chunks(rows, chunk_size=6)
    assert [len(c) for c in chunks] == [6, 6, 2]


def test_multi_step_pipeline_header_redo_and_merged_sku_split(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://100.89.215.68:11434")
    monkeypatch.setenv("OPENAI_MODEL", "qwen3.5:4b")

    md = (
        "DUMMY DATA\n\n"
        "## Sample Components Lab\n\n"
        "Invoice number: DEMO-006\n"
        "Invoice date: 2026-10-06\n"
        "Bill to: Example Semiconductor Company\n"
        "Currency: SGD\n\n"
        "| Part number | Description | Quantity | Unit price | Line total |\n"
        "|---|---|---|---|---|\n"
        "| RES-0603-10K | Resistor 10k ohm 0603 | 5000 | 0.015 | 75.00 |\n"
        "| | UNKNOWN-DEMO-PART Ceramic capacitor 100nF 0402 | 10000 | 0.0047 | 47.00 |\n"
        "| IC-LDO-33 | Voltage regulator 3.3V SOT-23 | 2000 | 0.185 | 370.00 |\n\n"
        "Subtotal 492.00\n"
        "Tax (9%) 44.28\n"
        "Total SGD 536.28\n"
    )

    calls = []
    responses = [
        # Step 1 initial header: misses supplier_name -> triggers Gatekeeper 1 Header Redo
        {
            "supplier_name": None,
            "invoice_number": "DEMO-006",
            "invoice_date": "2026-10-06",
            "currency": "SGD",
            "subtotal": "492.00",
            "tax": "44.28",
            "invoice_total": "536.28",
        },
        # Step 1 Redo: fixes supplier_name
        {
            "supplier_name": "Sample Components Lab",
            "invoice_number": "DEMO-006",
            "invoice_date": "2026-10-06",
            "currency": "SGD",
            "subtotal": "492.00",
            "tax": "44.28",
            "invoice_total": "536.28",
        },
        # Step 2 chunk extraction: row 2 has merged part_number + description
        {
            "lines": [
                {
                    "part_number": "RES-0603-10K",
                    "description": "Resistor 10k ohm 0603",
                    "quantity": "5000",
                    "unit_price": "0.015",
                    "line_total": "75.00",
                },
                {
                    "part_number": None,
                    "description": "UNKNOWN-DEMO-PART Ceramic capacitor 100nF 0402",
                    "quantity": "10000",
                    "unit_price": "0.0047",
                    "line_total": "47.00",
                },
                {
                    "part_number": "IC-LDO-33",
                    "description": "Voltage regulator 3.3V SOT-23",
                    "quantity": "2000",
                    "unit_price": "0.185",
                    "line_total": "370.00",
                },
            ]
        },
        # Step 3B micro-call: splits UNKNOWN-DEMO-PART from description
        {
            "part_number": "UNKNOWN-DEMO-PART",
            "description": "Ceramic capacitor 100nF 0402",
        },
    ]

    class FakeResp:
        def __init__(self, content_obj):
            self._content_obj = content_obj

        def raise_for_status(self):
            pass

        def json(self):
            return {
                "model": "qwen3.5:4b",
                "prompt_eval_count": 100,
                "eval_count": 40,
                "message": {"content": json.dumps(self._content_obj)},
            }

    class FakeHttpClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, json=None):
            calls.append((url, json))
            return FakeResp(responses.pop(0))

    monkeypatch.setattr("extract.local_pipeline.httpx.Client", FakeHttpClient)

    result = extract_with_usage(_doc(md), model="qwen3.5:4b", record_type=InvoiceRecord)
    assert len(calls) == 4
    assert result.record.supplier_name == "Sample Components Lab"
    assert result.record.lines[1].part_number == "UNKNOWN-DEMO-PART"
    assert result.record.lines[1].description == "Ceramic capacitor 100nF 0402"
    assert result.usage.total_tokens == 4 * 140


def test_surgical_refine_local_with_usage_updates_only_flagged_line(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://100.89.215.68:11434")
    monkeypatch.setenv("OPENAI_MODEL", "qwen3.5:4b")

    md = (
        "## Supplier\n"
        "| Part number | Description | Quantity | Unit | Unit price | Line total |\n"
        "|---|---|---|---|---|---|\n"
        "| PART-1 | First item | 2 | EA | 10.00 | 20.00 |\n"
        "| PART-2 | Second item | 5 | EA | 4.00 | 20.00 |\n"
    )
    draft = CheckingInvoice(
        supplier_name="Supplier",
        purchase_order="PO-1",
        invoice_number="INV-1",
        invoice_date="2026-10-05",
        currency="SGD",
        subtotal="40.00",
        tax="3.60",
        tax_rate="0.09",
        invoice_total="43.60",
        warnings=["Uncertain OCR"],
        lines=[
            {
                "part_number": "PART-1",
                "description": "First item",
                "quantity": "2",
                "unit": "EA",
                "unit_price": "10.00",
                "line_total": "20.00",
                "currency": "SGD",
                "exchange_rate": None,
                "discount_rate": None,
                "discount_amount": None,
                "flat_charge": False,
            },
            {
                "part_number": "PART-Z",
                "description": "Second item",
                "quantity": "5",
                "unit": "EA",
                "unit_price": "4.00",
                "line_total": "20.00",
                "currency": "SGD",
                "exchange_rate": None,
                "discount_rate": None,
                "discount_amount": None,
                "flat_charge": False,
            },
        ],
    )

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "model": "qwen3.5:4b",
                "prompt_eval_count": 80,
                "eval_count": 30,
                "message": {
                    "content": json.dumps(
                        {
                            "lines": [
                                {
                                    "part_number": "PART-2",
                                    "description": "Second item",
                                    "quantity": "5",
                                    "unit": "EA",
                                    "unit_price": "4.00",
                                    "line_total": "20.00",
                                    "currency": "SGD",
                                    "exchange_rate": None,
                                    "discount_rate": None,
                                    "discount_amount": None,
                                    "flat_charge": False,
                                }
                            ]
                        }
                    )
                },
            }

    class FakeHttpClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, json=None):
            return FakeResp()

    monkeypatch.setattr("extract.local_pipeline.httpx.Client", FakeHttpClient)

    refined = refine_with_usage(
        _doc(md),
        draft,
        ["Line 2: extracted part_number 'PART-Z' does not match any known catalog code."],
        model="qwen3.5:4b",
        record_type=CheckingInvoice,
    )
    assert refined.record.lines[0].part_number == "PART-1"
    assert refined.record.lines[1].part_number == "PART-2"
    assert refined.record.warnings == []


def test_header_gatekeeper_flags_missing_printed_subtotal():
    md = (
        "## Sample Components Lab\n\n"
        "Invoice number: DEMO-006\n"
        "Invoice date: 2026-10-06\n"
        "Currency: SGD\n\n"
        "492.00\n\n"
        "| Subtotal | |\n"
        "|---|---|\n"
        "| Tax (9%) | 44.28 |\n"
        "| Total SGD | 536.28 |\n"
    )
    draft = HeaderDraft(
        supplier_name="Sample Components Lab",
        invoice_number="DEMO-006",
        invoice_date="2026-10-06",
        currency="SGD",
        subtotal=None,
        tax="44.28",
        invoice_total="536.28",
    )
    issues = _validate_header_gatekeeper(draft, md, is_checking=False)
    assert any("subtotal is null" in issue for issue in issues)

