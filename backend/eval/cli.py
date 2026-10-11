"""Print the five scorer numbers. Replayed fixture answers are refused."""

from check import check as live_check
from check.compare import DEFAULT_SHEET
from check.sheet import load_price_sheet
from extract import extract_with_usage
from read.reader import read_pdf

from .score import score, write_report


def main() -> None:
    loaded = load_price_sheet(DEFAULT_SHEET)

    def check(invoice):
        return live_check(invoice, loaded)

    report = score(extract_with_usage, check, read_pdf)
    print(report.text())
    print(f"saved {write_report(report)}")
    if report.missed_mistakes:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
