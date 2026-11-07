"""A timed-out OCR invocation must not poison all later invoices."""

from pathlib import Path

import pytest
from test_api import lightweight_reader

from read import bounded

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


def test_default_reader_uses_a_killable_process_and_can_recover(monkeypatch):
    monkeypatch.setenv("INVOICE_OCR_TIMEOUT", "180")
    monkeypatch.delenv("INVOICE_OCR_SUBPROCESS", raising=False)
    calls = []

    def isolated(path, **kwargs):
        calls.append(path)
        if len(calls) == 1:
            raise TimeoutError("OCR worker terminated")
        return lightweight_reader(path)

    monkeypatch.setattr(bounded, "_read_pdf_subprocess", isolated)
    monkeypatch.setattr(
        bounded,
        "read_pdf",
        lambda *_args, **_kwargs: pytest.fail("OCR must not run in an unkillable thread"),
        raising=False,
    )
    with pytest.raises(TimeoutError):
        bounded.read_pdf_bounded(DATA / "invoice-01.pdf")
    assert bounded.read_pdf_bounded(DATA / "invoice-02.pdf").page_count > 0
