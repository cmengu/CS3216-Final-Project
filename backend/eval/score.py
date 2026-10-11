"""Score real extraction and checking against the dummy answer file. Never replayed answers."""

import json
import subprocess
import time
from dataclasses import dataclass, field
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

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "data" / "dummy" / "manifest.json"
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


@dataclass
class Tally:
    fields_ok: int = 0
    fields: int = 0
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

    def text(self) -> str:
        lines = []
        for kind in ("digital", "scan"):
            tally = self.by_kind.get(kind)
            if tally is None or tally.fields == 0:
                continue
            lines.append(kind)
            lines.append(f"fields read correctly: {_share(tally.fields_ok, tally.fields)}")
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
        if self.misses:
            lines.append("misses")
            for miss in self.misses:
                lines.append(
                    f"{miss['file']} {miss['field']} expected {miss['expected']} "
                    f"actual {miss['actual']}"
                )
        else:
            lines.append("misses")
            lines.append("none")
        return "\n".join(lines)


def score(extract_with_usage, check, read_pdf, *, manifest_path=MANIFEST_PATH, runs=3) -> Report:
    _refuse_fixtures(extract_with_usage, check)
    manifest = json.loads(Path(manifest_path).read_text())
    directory = Path(manifest_path).parent
    report = Report(by_kind={}, misses=[], missed_mistakes=[], runs=[])
    for _ in range(runs):
        for case in manifest["cases"]:
            for file in case["files"]:
                path = (directory / file["name"]).resolve()
                if not path.is_relative_to(directory.resolve()):
                    raise ValueError("The scorer only reads files from the dummy set")
                kind = file["kind"]
                tally = report.by_kind.setdefault(kind, Tally())
                started = time.perf_counter()
                document = read_pdf(path)
                extracted = extract_with_usage(document)
                record = extracted.record
                result = check(record)
                elapsed = time.perf_counter() - started
                tally.seconds.append(elapsed)
                usage = getattr(extracted, "usage", None)
                if usage is None or getattr(usage, "total_tokens", None) is None:
                    tally.tokens_known = False
                else:
                    tally.tokens.append(int(usage.total_tokens))
                actual_invoice = record.model_dump()
                actual_check = result.model_dump()
                _fields(tally, report.misses, file["name"], case["invoice"], actual_invoice, "")
                _check(tally, report.misses, file["name"], case["expected_check"], actual_check)
                _mistakes(tally, report.missed_mistakes, file["name"], case, actual_check)
                report.runs.append(
                    {
                        "file": file["name"],
                        "kind": kind,
                        "seconds": elapsed,
                        "tokens": None if usage is None else getattr(usage, "total_tokens", None),
                    }
                )
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
                "misses": report.misses,
                "missed_mistakes": report.missed_mistakes,
                "runs": report.runs,
            },
            indent=2,
        )
    )
    return path


def _refuse_fixtures(extract_with_usage, check) -> None:
    from api.stages import FixtureStages

    for step in (extract_with_usage, check):
        if isinstance(getattr(step, "__self__", None), FixtureStages):
            raise ValueError("The scorer refuses replayed answers from FixtureStages")


def _fields(tally, misses, filename, expected, actual, prefix) -> None:
    if isinstance(expected, dict):
        actual_dict = actual if isinstance(actual, dict) else {}
        for key, value in expected.items():
            _fields(tally, misses, filename, value, actual_dict.get(key), f"{prefix}{key}")
        return
    if isinstance(expected, list):
        for index, value in enumerate(expected):
            got = actual[index] if isinstance(actual, list) and index < len(actual) else None
            _fields(tally, misses, filename, value, got, f"{prefix}[{index}].")
        return
    name = prefix.rstrip(".")
    field_name = name.rsplit(".", 1)[-1]
    tally.fields += 1
    if _same(field_name, expected, actual):
        tally.fields_ok += 1
        return
    misses.append({"file": filename, "field": name, "expected": expected, "actual": actual})


def _check(tally, misses, filename, expected, actual) -> None:
    for index, expected_line in enumerate(expected["lines"]):
        actual_line = actual["lines"][index]
        if expected_line["status"] == "match":
            tally.correct_lines += 1
            if actual_line["status"] == "match":
                tally.correct_kept += 1
        for key, value in expected_line.items():
            tally.fields += 1
            got = actual_line.get(key)
            if _same(key, value, got):
                tally.fields_ok += 1
            else:
                misses.append(
                    {
                        "file": filename,
                        "field": f"check.lines[{index}].{key}",
                        "expected": value,
                        "actual": got,
                    }
                )
    tally.fields += 1
    if _same("overcharge_total", expected["overcharge_total"], actual["overcharge_total"]):
        tally.fields_ok += 1
    else:
        misses.append(
            {
                "file": filename,
                "field": "check.overcharge_total",
                "expected": expected["overcharge_total"],
                "actual": actual["overcharge_total"],
            }
        )


def _mistakes(tally, missed, filename, case, actual_check) -> None:
    for mistake in case["mistakes"]:
        tally.mistakes += 1
        index = mistake["line_index"]
        if index is None:
            caught = "Invoice arithmetic does not reconcile" in actual_check["warnings"]
        else:
            expected_status = case["expected_check"]["lines"][index]["status"]
            caught = actual_check["lines"][index]["status"] == expected_status
        if caught:
            tally.mistakes_caught += 1
        else:
            missed.append({"file": filename, "mistake": mistake})


def _same(field_name, expected, actual) -> bool:
    if expected is None or actual is None:
        return expected is None and actual is None
    if field_name in AMOUNT_FIELDS:
        try:
            return Decimal(str(expected)) == Decimal(str(actual))
        except InvalidOperation:
            return False
    return str(expected).strip().casefold() == str(actual).strip().casefold()


def _share(done, total) -> str:
    if total == 0:
        return "100%"
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
