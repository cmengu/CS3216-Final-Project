"""Bounded, reproducible evidence for understanding spreadsheet columns."""

import hashlib
import json
import random
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from itertools import combinations

PREVIEW_ROWS = 50
SAMPLE_ROWS = 10
MAX_PAYLOAD = 150_000


def heading(value):
    value = unicodedata.normalize("NFKD", value.casefold()).replace("đ", "d")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def sampled_indices(rows, *, start=0, count=SAMPLE_ROWS):
    """Include both ends and randomly sample the middle in reproducible strata."""
    populated = [i for i in range(start, len(rows)) if any(cell.strip() for cell in rows[i])]
    if len(populated) <= count:
        return populated
    seed = hashlib.sha256(
        json.dumps(
            [
                len(rows),
                [c[:120] for c in rows[populated[0]]],
                [c[:120] for c in rows[populated[-1]]],
            ]
        ).encode()
    ).digest()
    rng = random.Random(seed)
    selected = [populated[0], populated[-1]]
    middle = populated[1:-1]
    for bucket in range(count - 2):
        selected.append(
            rng.choice(
                middle[
                    bucket * len(middle) // (count - 2) : (bucket + 1) * len(middle) // (count - 2)
                ]
            )
        )
    return sorted(selected)


def number(value):
    raw = value.strip()
    if len(raw) > 80:
        return None
    if "," in raw:
        if not re.fullmatch(r"[+-]?\d{1,3}(,\d{3})+(\.\d+)?", raw):
            return None
        raw = raw.replace(",", "")
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,2})?", raw):
        return None
    try:
        value = Decimal(raw)
        return value if value.is_finite() and abs(value.adjusted()) <= 80 else None
    except InvalidOperation:
        return None


def indexed_row(index, row):
    return {
        "row_index": index,
        "cells": {str(i): cell[:120] for i, cell in enumerate(row) if cell.strip()},
    }


def column_profiles(rows, indices):
    profiles = []
    width = max((len(rows[i]) for i in indices), default=0)
    for column in range(width):
        values = [rows[i][column].strip() if column < len(rows[i]) else "" for i in indices]
        filled = [value for value in values if value]
        examples = list(dict.fromkeys(filled))[:3]
        profiles.append(
            {
                "column": column,
                "sampled_rows": len(indices),
                "nonempty": len(filled),
                "numeric": sum(number(v) is not None for v in filled),
                "distinct": len(set(filled)),
                "examples": [value[:80] for value in examples],
            }
        )
    return profiles


def multiplication_relations(rows, indices):
    """Evidence only: distinguish a unit rate from its extended amount."""
    profiles = column_profiles(rows, indices)
    columns = [p["column"] for p in profiles if p["numeric"] >= max(3, len(indices) * 0.8)][:12]
    values = {
        c: [number(rows[i][c]) if c < len(rows[i]) else None for i in indices] for c in columns
    }
    relations = []
    for left, right in combinations(columns, 2):
        for total in columns:
            if total in (left, right):
                continue
            tested = matches = 0
            for a, b, amount in zip(values[left], values[right], values[total]):
                if a is None or b is None or amount is None or a in (0, 1) or b in (0, 1):
                    continue
                tested += 1
                matches += abs(a * b - amount) <= Decimal("0.01")
            if tested >= 3 and matches == tested:
                relations.append(
                    {"factors": [left, right], "total": total, "supporting_rows": matches}
                )
    return relations[:10]


def build_payload(sheets):
    # Import here so the parser can share the heading normalizer without a cycle.
    from .master_import import FIELDS

    aliases = {alias for options in FIELDS.values() for alias in options}
    out = []
    for index, sheet in enumerate(sheets):
        rows = sheet["rows"]
        # Preserve indices in the editable preview, including headers after title blocks.
        populated = [
            i for i, row in enumerate(rows[:PREVIEW_ROWS]) if any(cell.strip() for cell in row)
        ]
        candidates = [
            i
            for i in populated
            if sum(heading(cell) in aliases for cell in rows[i]) >= 2
            or (
                sum(bool(cell.strip()) for cell in rows[i]) >= 2
                and not any(number(cell) is not None for cell in rows[i])
                and any(
                    any(number(cell) is not None for cell in following)
                    for following in rows[i + 1 : i + 3]
                )
            )
        ]
        context = sorted(set(populated[:8] + candidates[:4]))
        first = candidates[0] + 1 if candidates else (populated[0] + 1 if populated else 0)
        samples = sampled_indices(rows, start=first)
        out.append(
            {
                "sheet": index,
                "name": sheet["name"][:120],
                "row_count": len(rows),
                "non_empty_rows": [indexed_row(i, rows[i]) for i in context],
                "sample_rows": [indexed_row(i, rows[i]) for i in samples],
                "column_profiles": column_profiles(rows, samples),
                "multiplication_relations": multiplication_relations(rows, samples),
            }
        )
    payload = json.dumps(out, ensure_ascii=False)
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(
            "This workbook sample is too large for AI mapping. Select columns manually."
        )
    return payload
