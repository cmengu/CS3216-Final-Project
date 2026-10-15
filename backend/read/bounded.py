"""A stalled native import/conversion must not hold the API's processing slot forever."""

import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from .models import ParsedDocument
from .reader import validate_pdf


def read_pdf_bounded(path: Path, *, force_ocr: bool = False) -> ParsedDocument:
    validate_pdf(path)
    timeout = float(os.environ.get("INVOICE_OCR_TIMEOUT", "180"))
    if not 0 < timeout < float("inf"):
        raise ValueError("INVOICE_OCR_TIMEOUT must be a finite positive number")
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
