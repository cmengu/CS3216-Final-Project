"""Score real extraction and checking against the dummy answer file. Never replayed answers."""

import json
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

AMOUNT_FIELDS = {
    "quantity",
    "unit_price",
    "line_total",
    "subtotal",
    "tax",
    "invoice_total",
    "invoice_price",
    "agreed_price",
    "difference",
    "overcharge",
    "overcharge_total",
}

DATE_FIELDS = {"invoice_date"}

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "data" / "dummy" / "manifest.json"
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


@dataclass
class Tally:
    # Fields are what the reading steps produced. Results are what the check then said.
    fields_ok: int = 0
    fields: int = 0
    results_ok: int = 0
    results: int = 0
    mistakes_caught: int = 0
    mistakes: int = 0
    correct_lines: int = 0
    correct_kept: int = 0
    tokens: list[int] = field(default_factory=list)
    seconds: list[float] = field(default_factory=list)
    tokens_known: bool = True


@dataclass
class Report:
    by_kind: dict[str, Tally]
    misses: list[dict]
    missed_mistakes: list[dict]
    runs: list[dict]
    # Invoices a step refused. Each one is scored as wholly wrong, never dropped from the count.
    failures: list[dict] = field(default_factory=list)

    def text(self) -> str:
        lines = []
        for kind in ("digital", "scan"):
            tally = self.by_kind.get(kind)
            if tally is None or tally.fields == 0:
                continue
            lines.append(kind)
            lines.append(f"fields read correctly: {_share(tally.fields_ok, tally.fields)}")
            lines.append(
                f"check results equal to the answer file: {_share(tally.results_ok, tally.results)}"
            )
            lines.append(
                f"planted mistakes caught: {_share(tally.mistakes_caught, tally.mistakes)}"
            )
            lines.append(
                f"correct lines left unflagged: {_share(tally.correct_kept, tally.correct_lines)}"
            )
            if tally.tokens_known and tally.tokens:
                average = sum(tally.tokens) / len(tally.tokens)
                lines.append(f"cost per invoice: {average:.1f} tokens")
            else:
                lines.append("cost per invoice: not available")
            average_seconds = sum(tally.seconds) / len(tally.seconds) if tally.seconds else 0
            lines.append(f"seconds per invoice: {average_seconds:.3f}")
        if self.failures:
            lines.append("invoices a step refused")
            for failure in self.failures:
                lines.append(f"{failure['file']} run {failure['run']} {failure['reason']}")
        lines.append("misses")
        for miss in self.misses:
            lines.append(
                f"{miss['file']} run {miss['run']} {miss['field']} "
                f"expected {miss['expected']} actual {miss['actual']}"
            )
        if not self.misses:
            lines.append("none")
        return "\n".join(lines)


def score(extract_with_usage, check, read_pdf, *, manifest_path=MANIFEST_PATH, runs=3) -> Report:
    _refuse_fixtures(extract_with_usage, check)
    manifest = json.loads(Path(manifest_path).read_text())
    directory = Path(manifest_path).parent
    report = Report(by_kind={}, misses=[], missed_mistakes=[], runs=[])
    for run in range(1, runs + 1):
        for case in manifest["cases"]:
            for file in case["files"]:
                path = (directory / file["name"]).resolve()
                if not path.is_relative_to(directory.resolve()):
                    raise ValueError("The scorer only reads files beside its answer file")
                kind = file["kind"]
                tally = report.by_kind.setdefault(kind, Tally())
                where = {"file": file["name"], "run": run}
                started = time.perf_counter()
                usage = None
                actual_invoice, actual_check = {}, {}
                try:
                    extracted = extract_with_usage(read_pdf(path))
                    usage = getattr(extracted, "usage", None)
                    actual_invoice = extracted.record.model_dump()
                    actual_check = check(extracted.record).model_dump()
                except ValueError as exc:
                    # A step that cannot do its job says so with a ValueError. The run goes on,
                    # and everything this invoice should have produced is counted as wrong.
                    report.failures.append({**where, "reason": str(exc)})
                elapsed = time.perf_counter() - started
                tally.seconds.append(elapsed)
                tokens = getattr(usage, "total_tokens", None)
                if tokens is None:
                    tally.tokens_known = False
                else:
                    tally.tokens.append(int(tokens))
                _fields(tally, report.misses, where, case["invoice"], actual_invoice, "")
                _check(tally, report.misses, where, case["expected_check"], actual_check)
                _mistakes(tally, report.missed_mistakes, where, case, actual_check)
                report.runs.append({**where, "kind": kind, "seconds": elapsed, "tokens": tokens})
    return report


def write_report(report: Report, directory: Path = ARTIFACTS) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = directory / f"score-{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "code_version": _code_version(),
                "text": report.text(),
                "numbers": {kind: asdict(tally) for kind, tally in report.by_kind.items()},
                "failures": report.failures,
                "misses": report.misses,
                "missed_mistakes": report.missed_mistakes,
                "runs": report.runs,
            },
            indent=2,
        )
    )
    return path


def _refuse_fixtures(extract_with_usage, check) -> None:
    """Catches the fixture's own methods. A function that wraps one is not detected."""
    from api.stages import FixtureStages

    for step in (extract_with_usage, check):
        if isinstance(getattr(step, "__self__", None), FixtureStages):
            raise ValueError("The scorer refuses replayed answers from FixtureStages")


def _fields(tally, misses, where, expected, actual, prefix) -> None:
    if isinstance(expected, dict):
        actual_dict = actual if isinstance(actual, dict) else {}
        for key, value in expected.items():
            _fields(tally, misses, where, value, actual_dict.get(key), f"{prefix}{key}")
        return
    if isinstance(expected, list):
        actual_list = actual if isinstance(actual, list) else []
        for index, value in enumerate(expected):
            got = actual_list[index] if index < len(actual_list) else None
            _fields(tally, misses, where, value, got, f"{prefix}[{index}].")
        # A line the invoice does not print is one wrong field, so inventing lines costs points.
        for index in range(len(expected), len(actual_list)):
            tally.fields += 1
            misses.append(
                {**where, "field": f"{prefix}[{index}]", "expected": None, "actual": "extra line"}
            )
        return
    name = prefix.rstrip(".")
    tally.fields += 1
    if _same(name.rsplit(".", 1)[-1], expected, actual):
        tally.fields_ok += 1
        return
    misses.append({**where, "field": name, "expected": expected, "actual": actual})


def _check(tally, misses, where, expected, actual) -> None:
    actual_lines = actual.get("lines") or []
    for index, expected_line in enumerate(expected["lines"]):
        actual_line = actual_lines[index] if index < len(actual_lines) else {}
        if expected_line["status"] == "match":
            tally.correct_lines += 1
            if actual_line.get("status") == "match":
                tally.correct_kept += 1
        for key, value in expected_line.items():
            _result(
                tally, misses, where, f"check.lines[{index}].{key}", value, actual_line.get(key)
            )
    _result(
        tally,
        misses,
        where,
        "check.overcharge_total",
        expected["overcharge_total"],
        actual.get("overcharge_total"),
    )


def _result(tally, misses, where, name, expected, actual) -> None:
    tally.results += 1
    if _same(name.rsplit(".", 1)[-1], expected, actual):
        tally.results_ok += 1
        return
    misses.append({**where, "field": name, "expected": expected, "actual": actual})


def _mistakes(tally, missed, where, case, actual_check) -> None:
    actual_lines = actual_check.get("lines") or []
    for mistake in case["mistakes"]:
        tally.mistakes += 1
        index = mistake["line_index"]
        if index is None:
            caught = "Invoice arithmetic does not reconcile" in actual_check.get("warnings", [])
        else:
            expected_status = case["expected_check"]["lines"][index]["status"]
            caught = index < len(actual_lines) and actual_lines[index]["status"] == expected_status
        if caught:
            tally.mistakes_caught += 1
        else:
            missed.append({**where, "mistake": mistake})


def _same(field_name, expected, actual) -> bool:
    if expected is None or actual is None:
        return expected is None and actual is None
    if field_name in AMOUNT_FIELDS:
        try:
            return Decimal(str(expected)) == Decimal(str(actual))
        except InvalidOperation:
            return False
    if field_name in DATE_FIELDS:
        expected_day, actual_day = _day(expected), _day(actual)
        if expected_day and actual_day:
            return expected_day == actual_day
    return str(expected).strip().casefold() == str(actual).strip().casefold()


def _day(value) -> tuple[int, ...] | None:
    """Year, month and day as numbers, so 2026-10-1 is the same day as 2026-10-01."""
    parts = str(value).strip().split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    return tuple(int(part) for part in parts)


def _share(done, total) -> str:
    if total == 0:
        return "nothing to measure"
    return f"{done / total:.0%}"


def _code_version() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return result.stdout.strip() or "unknown"
