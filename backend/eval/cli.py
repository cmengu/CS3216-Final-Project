"""Print the scorer's numbers. Replayed fixture answers are refused."""

import argparse
from pathlib import Path

from check import check as live_check
from check.sheet import load_price_sheet
from extract import extract_with_usage
from read.reader import read_pdf

from .score import MANIFEST_PATH, score, write_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Score real extraction and checking.")
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH, help="the answer file")
    parser.add_argument(
        "--price-sheet",
        type=Path,
        help="the agreed prices; default is price-sheet.xlsx beside the answer file",
    )
    parser.add_argument("--runs", type=int, default=3, help="times each invoice is run")
    options = parser.parse_args()
    sheet = load_price_sheet(options.price_sheet or options.manifest.parent / "price-sheet.xlsx")

    def check(invoice):
        return live_check(invoice, sheet)

    report = score(
        extract_with_usage, check, read_pdf, manifest_path=options.manifest, runs=options.runs
    )
    print(report.text())
    print(f"saved {write_report(report)}")
    if report.missed_mistakes:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
