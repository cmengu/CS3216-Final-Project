"""Run PDFs through live stages, then score frozen predictions against a separate answer key."""

import argparse
import csv
import json
import os
import time
from collections import Counter
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

from api.live import LiveStages
from read.bounded import read_pdf_bounded
from read.models import ParsedDocument
from read.reader import validate_pdf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--out", type=Path, default=Path("runtime/mock-dataset-eval"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--ocr-cache", type=Path, help="Reuse OCR JSON only if PDF hash matches")
    args = parser.parse_args()
    load_dotenv(args.env_file)
    if not os.environ.get("OPENAI_API_KEY") or not os.environ.get("OPENAI_MODEL"):
        parser.error("Fill OPENAI_API_KEY and OPENAI_MODEL in the backend env file")
    files = sorted((args.dataset / "invoices").glob("*.pdf"))
    if not files:
        parser.error("No PDFs found in dataset/invoices")
    stages = LiveStages(args.dataset / "master_prices.csv", model=os.environ["OPENAI_MODEL"])
    args.out.mkdir(parents=True, exist_ok=True)
    predictions = []
    for path in files:
        start = time.monotonic()
        print(f"Processing {path.name}", flush=True)
        result = {"file": path.name}
        try:
            document = None
            cached = args.ocr_cache / f"{path.stem}.json" if args.ocr_cache else None
            if cached and cached.exists():
                document = ParsedDocument.model_validate_json(cached.read_text())
                if document.document_hash != validate_pdf(path)[0]:
                    raise ValueError("Cached OCR does not match PDF hash")
            if document is None:
                document = read_pdf_bounded(path)
            record = stages.extract(document)
            result["invoice"] = record.model_dump()
            check = stages.check(record)
            result.update(invoice=record.model_dump(), check=check.model_dump(), success=True)
        except Exception as exc:
            # Do not print provider bodies or credentials. Stage errors expose only class names.
            result.update(success=False, error=type(exc).__name__)
            cause = exc.__cause__
            if cause is not None:
                result["cause"] = type(cause).__name__
                result["http_status"] = getattr(cause, "status_code", None)
                result["error_code"] = getattr(cause, "code", None)
        result["seconds"] = round(time.monotonic() - start, 2)
        (args.out / f"{path.stem}.json").write_text(json.dumps(result, indent=2) + "\n")
        predictions.append(result)
        print(
            f"  {'completed' if result['success'] else 'FAILED'} ({result['seconds']}s)", flush=True
        )
        if result.get("http_status") in {401, 403, 404, 429}:
            print("Stopping: resolve provider access/quota before retrying the dataset", flush=True)
            break

    report = score_predictions(args.dataset, predictions, stages.model, stages.price_sheet_version)
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Report: {args.out / 'report.json'}", flush=True)
    if report["completed"] != len(files):
        raise SystemExit(1)


def score_predictions(
    dataset: Path, predictions: list[dict], model: str, sheet_version: str
) -> dict:
    # Answers enter only after inference has finished. Never pass them to extract or check.
    with (dataset / "answer_key/expected_invoice_lines.csv").open(encoding="utf-8-sig") as file:
        gold = list(csv.DictReader(file))
    scores = []
    for prediction in predictions:
        expected = [row for row in gold if row["filename"] == prediction["file"]]
        score = {
            "file": prediction["file"],
            "success": prediction["success"],
            "expected_lines": len(expected),
        }
        if prediction["success"]:
            actual = prediction["check"]["lines"]
            score["extracted_lines"] = len(actual)
            score["status_counts"] = dict(Counter(line["status"] for line in actual))
            aligned = len(actual) == len(expected)
            score["same_line_count"] = aligned
            # Positional comparison assumes printed order; line count differences get no credit.
            score["correct_statuses_in_order"] = (
                sum(
                    line["status"] == ("match" if row["flag"] == "PASS" else "price_mismatch")
                    for line, row in zip(actual, expected)
                )
                if aligned
                else 0
            )
            score["correct_prices_in_order"] = (
                sum(
                    line["invoice_price"] is not None
                    and Decimal(line["invoice_price"]) == Decimal(row["unit_price"])
                    for line, row in zip(actual, expected)
                )
                if aligned
                else 0
            )
            score["warnings"] = prediction["check"]["warnings"]
        scores.append(score)
    return {
        "model": model,
        "reasoning_effort": os.environ.get("OPENAI_REASONING_EFFORT"),
        "price_sheet_version": sheet_version,
        "dataset_invoices": len(list((dataset / "invoices").glob("*.pdf"))),
        "attempted": len(predictions),
        "completed": sum(row["success"] for row in predictions),
        "expected_lines": len(gold),
        "correct_statuses_in_order": sum(row.get("correct_statuses_in_order", 0) for row in scores),
        "correct_prices_in_order": sum(row.get("correct_prices_in_order", 0) for row in scores),
        "results": scores,
    }


if __name__ == "__main__":
    main()
