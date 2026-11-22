"""Use real child processes to prove reuse, hard termination, and next-job recovery."""

import hashlib
import logging
import os
import threading
import time
from pathlib import Path

import pytest
from test_api import lightweight_reader

from api.execution import InvoiceExecutor
from api.processing import LostLease
from api.stages import FixtureStages

DATA = Path(__file__).resolve().parents[2] / "data/dummy"


class StuckStages(FixtureStages):
    def extract(self, document):
        while True:
            pass


class EscapingError(BaseException):
    """Like SystemExit or KeyboardInterrupt from a native library: not an Exception."""


class EscapingStages(FixtureStages):
    def extract(self, document):
        raise EscapingError("document text must not reach the log")


class DyingStages(FixtureStages):
    def extract(self, document):
        os._exit(7)  # a worker that disappears, as in a native crash


def execute(executor, stages, saved, **kwargs):
    path = DATA / "invoice-01.pdf"
    return executor.execute(
        path,
        path.name,
        hashlib.sha256(path.read_bytes()).hexdigest(),
        stages,
        lambda status, **values: saved.append((status, values)),
        reader=lightweight_reader,
        **kwargs,
    )


def test_warm_process_is_reused_and_a_stuck_extractor_is_killed():
    executor = InvoiceExecutor()
    try:
        saved = []
        assert execute(executor, FixtureStages(DATA), saved, timeout=20)
        original_pid = executor.process.pid
        assert execute(executor, FixtureStages(DATA), [], timeout=5)
        assert executor.process.pid == original_pid
        failed = []
        started = time.monotonic()
        assert execute(executor, StuckStages(DATA), failed, timeout=0.4) is False
        assert time.monotonic() - started < 5
        assert executor.process is None
        assert failed[-1][0] == "failed"
        assert "extracting:" in failed[-1][1]["error"]
        assert "worker terminated" in failed[-1][1]["error"]
        assert execute(executor, FixtureStages(DATA), [], timeout=20)
        assert executor.process.pid != original_pid
    finally:
        executor.close()


def test_lost_ownership_stops_the_child_without_publishing_a_failure():
    executor = InvoiceExecutor()
    try:
        assert execute(executor, FixtureStages(DATA), [], timeout=20)
        cancelled = threading.Event()
        cancelled.set()
        saved = []
        with pytest.raises(LostLease):
            execute(executor, StuckStages(DATA), saved, timeout=5, cancel=cancelled)
        assert executor.process is None
        assert saved == []
    finally:
        executor.close()


def test_an_escaped_worker_error_is_logged_with_its_type_and_place(caplog):
    executor = InvoiceExecutor()
    try:
        failed = []
        with caplog.at_level(logging.ERROR, logger="api.execution"):
            assert execute(executor, EscapingStages(DATA), failed, timeout=20) is False
        assert failed[-1] == (
            "failed",
            {"error": "extracting: Invoice worker failed; upload again to retry"},
        )
        logged = caplog.text
        assert "EscapingError" in logged
        assert "test_invoice_execution.py" in logged and "extract" in logged
        assert "worker exit code 1" in logged
        assert "document text" not in logged
        assert execute(executor, FixtureStages(DATA), [], timeout=20)
    finally:
        executor.close()


def test_a_worker_that_dies_is_logged_with_its_exit_code(caplog):
    executor = InvoiceExecutor()
    try:
        failed = []
        with caplog.at_level(logging.ERROR, logger="api.execution"):
            assert execute(executor, DyingStages(DATA), failed, timeout=20) is False
        assert failed[-1][1]["error"] == "extracting: Invoice worker failed; upload again to retry"
        assert "worker process ended without reporting an error" in caplog.text
        assert "worker exit code 7" in caplog.text
        assert execute(executor, FixtureStages(DATA), [], timeout=20)
    finally:
        executor.close()
