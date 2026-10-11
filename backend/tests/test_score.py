import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.contracts import CheckResult
from api.stages import FixtureStages
from eval import cli, score, write_report
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
    # Each run lists its own miss once: 20 files, three runs.
    assert len(report.misses) == 60
    assert {miss["run"] for miss in report.misses} == {1, 2, 3}
    assert "fields read correctly: 9" in report.text()
    assert "check results equal to the answer file: 100%" in report.text()


def test_a_dropped_line_is_scored_as_wrong_and_does_not_stop_the_run():
    def extract(document):
        record = _extract(document).record
        record.lines = record.lines[:1]
        return SimpleNamespace(record=record, usage=None)

    def check(invoice):
        result = _check(invoice)
        result.lines = result.lines[:1]
        return result

    report = score(extract, check, _read, runs=1)
    assert any(miss["field"] == "lines[1].part_number" for miss in report.misses)
    assert any(miss["field"] == "check.lines[1].status" for miss in report.misses)
    # Invoice 03 plants its mistakes on lines 1 and 2, which are no longer there.
    assert any(miss["file"] == "invoice-03.pdf" for miss in report.missed_mistakes)


def test_an_invented_line_is_a_miss():
    def extract(document):
        record = _extract(document).record
        record.lines = [*record.lines, record.lines[0]]
        return SimpleNamespace(record=record, usage=None)

    report = score(extract, _check, _read, runs=1)
    extra = [miss for miss in report.misses if miss["actual"] == "extra line"]
    assert len(extra) == 20
    assert "fields read correctly: 100%" not in report.text()


def test_an_invoice_a_step_refuses_is_scored_as_wrong_and_the_run_goes_on():
    def extract(document):
        if document.filename == "invoice-02.pdf":
            raise ValueError("Extraction was incomplete or refused; no invoice was accepted")
        return _extract(document)

    report = score(extract, _check, _read, runs=1)
    assert report.failures == [
        {
            "file": "invoice-02.pdf",
            "run": 1,
            "reason": "Extraction was incomplete or refused; no invoice was accepted",
        }
    ]
    assert len(report.runs) == 20
    assert [miss["file"] for miss in report.missed_mistakes] == ["invoice-02.pdf"]
    assert "invoices a step refused" in report.text()


def test_a_date_is_compared_as_a_date():
    def extract(document):
        record = _extract(document).record
        year, month, day = record.invoice_date.split("-")
        record.invoice_date = f"{year}-{month}-{int(day)}"
        return SimpleNamespace(record=record, usage=None)

    assert score(extract, _check, _read, runs=1).misses == []


def test_the_command_ends_with_an_error_when_a_planted_mistake_is_missed(tmp_path, monkeypatch):
    def check(invoice, sheet):
        result = _check(invoice)
        result.lines[0].status = "match"
        return result

    monkeypatch.setattr(cli, "extract_with_usage", _extract)
    monkeypatch.setattr(cli, "read_pdf", _read)
    monkeypatch.setattr(cli, "live_check", check)
    monkeypatch.setattr(cli, "write_report", lambda report: write_report(report, tmp_path))
    monkeypatch.setattr("sys.argv", ["invoice-score", "--runs", "1"])
    with pytest.raises(SystemExit) as stopped:
        cli.main()
    assert stopped.value.code == 1


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
    return CheckResult.model_validate({**case["expected_check"], "price_sheet_version": "sheet"})


def _case_for_invoice(invoice):
    manifest = json.loads((DATA / "manifest.json").read_text())
    for case in manifest["cases"]:
        if case["invoice"]["invoice_number"] == invoice.invoice_number:
            return case
    raise AssertionError(invoice.invoice_number)
