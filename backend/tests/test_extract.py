"""F-03 field extraction. The model client is fake; nothing here calls a network."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from openai import OpenAIError
from pydantic import ValidationError

from extract import extract, extract_with_usage
from read.models import ParsedDocument
from schema import InvoiceRecord

DATA = Path(__file__).resolve().parents[2] / "data/dummy"

PRINTED = {
    "supplier_name": "Demo Circuit Supplies",
    "invoice_number": "DEMO-001",
    "invoice_date": "2026-10-01",
    "currency": "SGD",
    "subtotal": "477.00",
    "tax": "42.93",
    "invoice_total": "519.93",
    "lines": [
        {
            "part_number": "RES-0603-10K",
            "description": "Resistor 10k ohm 0603",
            "quantity": "5000",
            "unit_price": "0.012",
            "line_total": "60.00",
        }
    ],
}


def page(markdown="Invoice DEMO-001\nRate (SGD) 0.012\n"):
    return ParsedDocument(
        document_hash="a" * 64,
        filename="invoice-01.pdf",
        page_count=1,
        reader_version="test",
        markdown=markdown,
        blocks=[],
        docling_document={},
    )


class FakeClient:
    def __init__(self, response):
        self.calls = []
        self._response = response

    @property
    def responses(self):
        return self

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def completed(parsed=PRINTED, *, status="completed", usage=None, model="gpt-test"):
    if usage is None:
        usage = SimpleNamespace(input_tokens=11, output_tokens=22, total_tokens=33)
    return SimpleNamespace(status=status, output_parsed=parsed, model=model, usage=usage)


def test_extract_returns_the_printed_fields(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = FakeClient(completed())
    record = extract(page(), client=client, model="gpt-test")
    assert record == InvoiceRecord.model_validate(PRINTED)
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["text_format"] is InvoiceRecord
    assert "temperature" not in call  # Reasoning models may reject temperature overrides.
    assert call["store"] is False
    assert call["input"][1]["content"] == page().markdown
    instructions = call["input"][0]["content"].lower()
    assert "do not calculate" in instructions
    assert "null" in instructions


def test_token_counts_sit_beside_the_record():
    result = extract_with_usage(page(), client=FakeClient(completed()), model="gpt-test")
    assert result.record == InvoiceRecord.model_validate(PRINTED)
    assert result.usage.model == "gpt-test"
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 22
    assert result.usage.total_tokens == 33


def test_missing_key_fails_before_any_call(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-test")
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        extract(page())


def test_missing_model_name_fails_before_any_call(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    client = FakeClient(completed())
    with pytest.raises(ValueError, match="OPENAI_MODEL"):
        extract(page(), client=client)
    assert client.calls == []


def test_refused_or_incomplete_answer_is_not_returned():
    client = FakeClient(completed(parsed=None, status="incomplete"))
    with pytest.raises(ValueError, match="no invoice was accepted"):
        extract(page(), client=client, model="gpt-test")


def test_completed_response_without_a_record_is_refused():
    client = FakeClient(completed(parsed=None, status="completed"))
    with pytest.raises(ValueError, match="no invoice was accepted"):
        extract(page(), client=client, model="gpt-test")


def test_answer_outside_the_field_list_raises():
    broken = {**PRINTED, "lines": [{"part_number": "X", "quantity": "1,000"}]}
    client = FakeClient(completed(parsed=broken))
    with pytest.raises((ValueError, ValidationError), match="no invoice was accepted|part_number"):
        extract(page(), client=client, model="gpt-test")


def test_provider_error_hides_the_page_text():
    secret = "SECRET-PAGE-TEXT"
    client = FakeClient(OpenAIError(secret))
    with pytest.raises(ValueError, match="no invoice was accepted") as raised:
        extract(page(secret), client=client, model="gpt-test")
    assert secret not in str(raised.value)


def test_missing_token_counts_are_not_invented():
    response = SimpleNamespace(
        status="completed", output_parsed=PRINTED, model="gpt-test", usage=None
    )
    with pytest.raises(ValueError, match="token counts"):
        extract_with_usage(page(), client=FakeClient(response), model="gpt-test")


def test_blank_or_oversized_text_is_not_sent():
    client = FakeClient(completed())
    with pytest.raises(ValueError, match="no page text"):
        extract(page("  \n"), client=client, model="gpt-test")
    with pytest.raises(ValueError, match="too long"):
        extract(page("x" * 200_001), client=client, model="gpt-test")
    assert client.calls == []


@pytest.mark.model
def test_each_dummy_pdf_matches_its_manifest_record():
    manifest = json.loads((DATA / "manifest.json").read_text())
    from read.reader import read_pdf

    for case in manifest["cases"]:
        for file in case["files"]:
            path = (DATA / file["name"]).resolve()
            assert path.is_relative_to(DATA.resolve())
            record = extract(read_pdf(path))
            assert record.model_dump() == case["invoice"]
