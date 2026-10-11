import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.contracts import CheckResult
from api.stages import FixtureStages
from eval import score, write_report
from read.models import ParsedDocument
from schema import InvoiceRecord

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


def test_manifest_answers_score_one_hundred_percent():
    report = score(_extract, _check, _read, runs=3)
    text = report.text()
    assert "fields read correctly: 100%" in text
    assert "planted mistakes caught: 100%" in text
    assert "correct lines left unflagged: 100%" in text
    assert "cost per invoice: not available" in text
    assert report.misses == []
    assert report.missed_mistakes == []


def test_one_changed_field_is_the_only_miss():
    def extract(document):
        record = _extract(document).record
        record.supplier_name = "Other Supplier"
        return SimpleNamespace(record=record, usage=None)

    report = score(extract, _check, _read, runs=3)
    assert {miss["field"] for miss in report.misses} == {"supplier_name"}
    assert report.missed_mistakes == []


def test_a_missed_planted_mistake_is_recorded():
    def check(invoice):
        result = _check(invoice)
        result.lines[0].status = "match"
        return result

    report = score(_extract, check, _read, runs=1)
    assert report.missed_mistakes
    assert any(miss["field"].endswith(".status") for miss in report.misses)


def test_fixture_stages_are_refused():
    stages = FixtureStages(DATA)
    with pytest.raises(ValueError, match="FixtureStages"):
        score(stages.extract, _check, _read, runs=1)


def test_report_file_names_the_code_version(tmp_path):
    path = write_report(score(_extract, _check, _read, runs=1), tmp_path)
    saved = json.loads(path.read_text())
    assert saved["code_version"]
    assert "100%" in saved["text"]


def _read(path):
    return ParsedDocument(
        document_hash="b" * 64,
        filename=Path(path).name,
        page_count=1,
        reader_version="test",
        markdown="page text",
        blocks=[],
        docling_document={},
    )


def _case_for(filename):
    manifest = json.loads((DATA / "manifest.json").read_text())
    for case in manifest["cases"]:
        if any(file["name"] == filename for file in case["files"]):
            return case
    raise AssertionError(filename)


def _extract(document):
    case = _case_for(document.filename)
    return SimpleNamespace(
        record=InvoiceRecord.model_validate(case["invoice"]),
        usage=None,
    )


def _check(invoice):
    case = _case_for_invoice(invoice)
    return CheckResult.model_validate(
        {**case["expected_check"], "price_sheet_version": "sheet"}
    )


def _case_for_invoice(invoice):
    manifest = json.loads((DATA / "manifest.json").read_text())
    for case in manifest["cases"]:
        if case["invoice"]["invoice_number"] == invoice.invoice_number:
            return case
    raise AssertionError(invoice.invoice_number)
