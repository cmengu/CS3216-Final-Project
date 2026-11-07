"""A shared deadline for the OCR/model/check steps of one invoice."""

import math
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar

_deadline = ContextVar("invoice_processing_deadline", default=None)


class ProcessingTimeout(ValueError):
    """A safe, user-visible explanation for a bounded processing failure."""


def current_deadline():
    return _deadline.get()


def remaining_timeout(seconds):
    deadline = current_deadline()
    if deadline is None:
        return seconds
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ProcessingTimeout(
            "Invoice processing exceeded its time limit. Upload again to retry."
        )
    return min(seconds, remaining)


def check_budget():
    remaining_timeout(float("inf"))


@contextmanager
def invoice_budget(seconds=None):
    seconds = (
        float(os.environ.get("INVOICE_PROCESSING_TIMEOUT_SECONDS", "900"))
        if seconds is None
        else seconds
    )
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("INVOICE_PROCESSING_TIMEOUT_SECONDS must be finite and positive")
    deadline = time.monotonic() + seconds
    parent = current_deadline()
    token = _deadline.set(min(parent, deadline) if parent is not None else deadline)
    try:
        yield
    finally:
        _deadline.reset(token)
