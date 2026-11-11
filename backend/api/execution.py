"""Reusable process isolation for the entire invoice pipeline, supervised by the API."""

import logging
import multiprocessing
import os
import queue
import threading
import time
import traceback
from pathlib import Path

from fastapi import HTTPException

from .fleet import count, seconds
from .processing import LostLease, process_stored_invoice

log = logging.getLogger(__name__)


def _describe(exc):
    """Error type and where it was raised. No message: it could quote document content."""
    frames = traceback.extract_tb(exc.__traceback__)[-8:]
    where = " <- ".join(
        f"{Path(frame.filename).name}:{frame.lineno} {frame.name}" for frame in reversed(frames)
    )
    return f"{type(exc).__module__}.{type(exc).__qualname__} at {where or 'unknown'}"


def _child(connection):
    # Never mix native/parser logs or document content into the IPC protocol/API logs.
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
    parent_process = multiprocessing.parent_process()
    if parent_process is not None:

        def parent_exit():
            parent_process.join()
            os._exit(1)

        threading.Thread(target=parent_exit, daemon=True, name="invoice-parent-watch").start()
    if os.name == "posix":
        # The worker must not survive a killed API parent on Linux.
        import ctypes
        import signal

        parent = parent_process.pid if parent_process is not None else os.getppid()
        libc = ctypes.CDLL(None)
        if hasattr(libc, "prctl"):
            libc.prctl(1, signal.SIGKILL)
            if os.getppid() != parent:
                os._exit(1)
    from read.reader import read_pdf

    connection.send(("ready",))
    while True:
        try:
            command = connection.recv()
        except EOFError:
            return
        if command is None:
            return
        path, filename, document_hash, selected, force_ocr, totals_only, reader = command

        def save(status, **values):
            connection.send(("save", status, values))
            if connection.recv() != "saved":
                raise LostLease()

        try:
            completed = process_stored_invoice(
                path,
                filename,
                document_hash,
                selected,
                reader or read_pdf,
                save,
                force_ocr=force_ocr,
                totals_only=totals_only,
            )
            connection.send(("done", completed))
        except BaseException as exc:
            # Errors that escape the pipeline's own handling (including SystemExit and
            # KeyboardInterrupt from native libraries) are reported, not silently lost.
            try:
                connection.send(("error", _describe(exc)))
            except Exception:
                pass
            if not isinstance(exc, Exception):
                raise


class InvoiceExecutor:
    """One warm process per API replica; shared DB leases bound fleet concurrency."""

    def __init__(self, target=_child):
        self.target = target
        self.lock = threading.Lock()
        self.process = self.connection = self.receiver = None
        self.messages = queue.Queue(maxsize=1)
        self.closed = threading.Event()
        self.stopping = threading.Event()
        self.safe_to_release = True
        self.tasks = 0

    def _start(self):
        if self.process is not None and self.process.is_alive():
            return
        self._stop()
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        self.connection = parent
        self.closed = threading.Event()
        self.messages = queue.Queue(maxsize=1)
        self.process = context.Process(target=self.target, args=(child,), daemon=True)
        self.process.start()
        self.tasks = 0
        child.close()
        closed, messages = self.closed, self.messages

        def receive():
            try:
                while not closed.is_set():
                    message = parent.recv()
                    while not closed.is_set():
                        try:
                            messages.put(message, timeout=0.1)
                            break
                        except queue.Full:
                            pass
            except (EOFError, OSError) as exc:
                reason = (
                    "worker process ended without reporting an error"
                    if isinstance(exc, EOFError)
                    else f"worker pipe failed: {type(exc).__name__}"
                )
                while not closed.is_set():
                    try:
                        messages.put(("error", reason), timeout=0.1)
                        break
                    except queue.Full:
                        pass

        self.receiver = threading.Thread(target=receive, daemon=True, name="invoice-results")
        self.receiver.start()

    def _stop(self):
        self.warm = False
        self.closed.set()
        if self.process is not None:
            if self.process.is_alive():
                self.safe_to_release = False
                self.process.terminate()
                self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=2)
            if self.process.is_alive():
                # Fail closed: capacity must not be reused if termination failed.
                raise RuntimeError("Invoice process could not be terminated")
            self.process.close()
            self.process = None
        self.safe_to_release = True
        if self.connection is not None:
            self.connection.close()
            self.connection = None
        if self.receiver is not None:
            self.receiver.join(timeout=1)
            self.receiver = None

    def _exitcode(self):
        """A worker that is dying reports its exit code within a moment; a live one gives None."""
        process = self.process
        if process is None:
            return None
        process.join(timeout=1)
        return process.exitcode

    def close(self):
        self.stopping.set()
        with self.lock:
            self._stop()

    def execute(
        self,
        path,
        filename,
        document_hash,
        selected,
        save,
        *,
        force_ocr=False,
        totals_only=False,
        cancel=None,
        reader=None,
        timeout=None,
    ):
        timeout = seconds("INVOICE_PROCESSING_TIMEOUT_SECONDS", 900) if timeout is None else timeout
        with self.lock:
            started = time.monotonic()
            deadline = started + timeout
            stage, last_stage = "reading", started
            command_sent = False
            ocr_deadline = None
            terminal_saved = False
            completed_saved = False
            try:
                self._start()
                # An existing warm process has already sent its ready message.
                if getattr(self, "warm", False):
                    self.safe_to_release = False
                    self.connection.send(
                        (path, filename, document_hash, selected, force_ocr, totals_only, reader)
                    )
                    command_sent = True
                    ocr_deadline = time.monotonic() + seconds("INVOICE_OCR_TIMEOUT", 180)
                while True:
                    if self.stopping.is_set() or (cancel is not None and cancel.is_set()):
                        raise LostLease()
                    now = time.monotonic()
                    if now >= deadline or (
                        stage == "reading" and ocr_deadline is not None and now >= ocr_deadline
                    ):
                        raise TimeoutError(
                            "Invoice processing exceeded its time limit; worker terminated"
                        )
                    try:
                        message = self.messages.get(timeout=min(0.1, max(0.001, deadline - now)))
                    except queue.Empty:
                        continue
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            "Invoice processing exceeded its time limit; worker terminated"
                        )
                    if self.stopping.is_set() or (cancel is not None and cancel.is_set()):
                        raise LostLease()
                    if message[0] == "ready":
                        self.warm = True
                        self.safe_to_release = False
                        log.info("Invoice process startup seconds=%.3f", time.monotonic() - started)
                        last_stage = time.monotonic()
                        self.connection.send(
                            (
                                path,
                                filename,
                                document_hash,
                                selected,
                                force_ocr,
                                totals_only,
                                reader,
                            )
                        )
                        command_sent = True
                        ocr_deadline = time.monotonic() + seconds("INVOICE_OCR_TIMEOUT", 180)
                    elif message[0] == "save":
                        status, values = message[1:]
                        log.info(
                            "Invoice stage=%s seconds=%.3f", stage, time.monotonic() - last_stage
                        )
                        last_stage = time.monotonic()
                        stage = status if status not in {"completed", "failed"} else stage
                        if status in {"completed", "failed"}:
                            self.safe_to_release = True
                        save(status, **values)
                        terminal_saved = status in {"completed", "failed"}
                        completed_saved = status == "completed"
                        self.connection.send("saved")
                    elif message[0] == "done" and command_sent:
                        self.tasks += 1
                        if self.tasks >= count("INVOICE_WORKER_MAX_JOBS", 100):
                            self._stop()
                        return message[1]
                    else:
                        detail = (
                            message[1]
                            if message[0] == "error" and len(message) > 1
                            else f"unexpected worker message {message[0]!r}"
                        )
                        raise RuntimeError(f"Invoice worker stopped unexpectedly: {detail}")
            except LostLease:
                self.warm = False
                self._stop()
                raise
            except Exception as exc:
                self.warm = False
                exitcode = self._exitcode() if isinstance(exc, RuntimeError) else None
                self._stop()
                # The saved error stays generic for the clerk; the log names the cause.
                log.error(
                    "Invoice worker failed at stage=%s: %s; worker exit code %s",
                    stage,
                    str(exc) if isinstance(exc, (RuntimeError, TimeoutError)) else _describe(exc),
                    "still running"
                    if exitcode is None
                    else f"{exitcode} (0x{exitcode & 0xFFFFFFFF:08X})",
                )
                if not terminal_saved:
                    reason = (
                        str(exc.detail)
                        if isinstance(exc, HTTPException) and exc.status_code == 413
                        else str(exc)
                        if isinstance(exc, TimeoutError)
                        else "Invoice worker failed; upload again to retry"
                    )
                    save("failed", error=f"{stage}: {reason}")
                return completed_saved
