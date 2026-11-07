"""OCR and model requests share a deadline and never publish overdue success."""

import hashlib
from pathlib import Path

import pytest
from test_api import lightweight_reader

from api.processing import process_stored_invoice
from api.stages import FixtureStages
from read import budget

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


class Clock:
    now = 0

    def monotonic(self):
        return self.now


def test_nested_budgets_do_not_extend_a_deadline_and_are_reset(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(budget, "time", clock)
    assert budget.current_deadline() is None
    with budget.invoice_budget(10):
        assert budget.remaining_timeout(120) == 10
        with budget.invoice_budget(100):
            assert budget.current_deadline() == 10
            clock.now = 11
            with pytest.raises(budget.ProcessingTimeout):
                budget.check_budget()
    assert budget.current_deadline() is None
    assert budget.remaining_timeout(120) == 120


def test_a_stage_cannot_publish_success_after_exhausting_its_budget(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(budget, "time", clock)
    monkeypatch.setenv("INVOICE_PROCESSING_TIMEOUT_SECONDS", "10")
    stages = FixtureStages(DATA)
    extract = stages.extract

    def slow_extract(document):
        record = extract(document)
        clock.now = 11
        return record

    monkeypatch.setattr(stages, "extract", slow_extract)
    saved = []
    path = DATA / "invoice-01.pdf"
    completed = process_stored_invoice(
        path,
        path.name,
        hashlib.sha256(path.read_bytes()).hexdigest(),
        stages,
        lightweight_reader,
        lambda status, **values: saved.append((status, values)),
    )
    assert completed is False
    assert all(status != "completed" for status, _ in saved)
    assert saved[-1][0] == "failed"
    assert "time limit" in saved[-1][1]["error"]
    assert budget.current_deadline() is None
