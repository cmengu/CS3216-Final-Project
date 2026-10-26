"""A stalled native import/conversion must not hold the API's processing slot forever."""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from tempfile import TemporaryDirectory

from .models import ParsedDocument
from .reader import read_pdf, validate_pdf

_ORIGINAL_SUBPROCESS_RUN = subprocess.run
_WARM_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="invoice-ocr-warm")


def _read_pdf_subprocess(path: Path, *, force_ocr: bool, timeout: float) -> ParsedDocument:
    with TemporaryDirectory(prefix="invoice-ocr-") as directory:
        output = Path(directory) / "document.json"
        command = [sys.executable, "-m", "read.worker", str(path.resolve()), "--out", str(output)]
        if force_ocr:
            command.append("--force-ocr")
        try:
            result = subprocess.run(
                command,
                cwd=Path(__file__).resolve().parents[1],
                env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
                capture_output=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError(
                f"OCR exceeded {timeout:g}s, including native imports; worker terminated"
            ) from exc
        if result.returncode:
            # Native/library logs can contain document data; do not expose them in HTTP errors.
            raise ValueError(f"OCR worker failed (exit {result.returncode})")
        return ParsedDocument.model_validate_json(output.read_text(encoding="utf-8"))


def read_pdf_bounded(path: Path, *, force_ocr: bool = False) -> ParsedDocument:
    validate_pdf(path)
    timeout = float(os.environ.get("INVOICE_OCR_TIMEOUT", "180"))
    if not 0 < timeout < float("inf"):
        raise ValueError("INVOICE_OCR_TIMEOUT must be a finite positive number")

    use_subprocess = (
        os.environ.get("INVOICE_OCR_SUBPROCESS", "").strip().lower() in ("1", "true", "yes")
        or subprocess.run is not _ORIGINAL_SUBPROCESS_RUN
        or timeout < 1.0
    )
    if use_subprocess:
        return _read_pdf_subprocess(path, force_ocr=force_ocr, timeout=timeout)

    future = _WARM_EXECUTOR.submit(read_pdf, path, force_ocr=force_ocr)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError as exc:
        raise TimeoutError(
            f"OCR exceeded {timeout:g}s, including native imports; worker terminated"
        ) from exc
    except Exception as exc:
        raise ValueError("OCR worker failed (exit 1)") from exc
