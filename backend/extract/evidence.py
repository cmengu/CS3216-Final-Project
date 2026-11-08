"""Conservative source grounding. Arithmetic is diagnostic, never a source of values."""

import re
import unicodedata
from datetime import date
from decimal import Decimal

from read.models import ParsedDocument
from schema import InvoiceRecord


def compact(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def numbers(text: str) -> set[Decimal]:
    # Do not match 278 inside an OCR token like S60278, or 12 inside a product code.
    return {
        Decimal(m.group().replace(",", ""))
        for m in re.finditer(r"(?<![\w.])-?\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])", text)
    }


def source_numbers(text: str) -> set[Decimal]:
    text = re.sub(r"(?i)(?:US\$|S\$|SGD|USD|CNY|EUR|RMB|\$)(?=\d)", " ", text)
    text = re.sub(r"(?i)(?<!\w)[x×](?=\d)", " ", text)
    return numbers(text)


def percentages(text: str) -> set[Decimal]:
    return {
        Decimal(match.group(1)) for match in re.finditer(r"(?<![\w.])(\d+(?:\.\d+)?)\s*%", text)
    }


def _windows(text: str) -> list[str]:
    lines = text.splitlines()
    windows = []
    for i, line in enumerate(lines):
        if line.strip().startswith("|") and line.count("|") >= 3:
            windows.append(line)
            continue
        span = [line]
        for following in lines[i + 1 : i + 8]:
            # A prose/header window must not accidentally encompass several table rows.
            if following.strip().startswith("|") or re.match(r"^\s*\d+[.)]\s+\S", following):
                break
            span.append(following)
        windows.append("\n".join(span)[:1400])
    # Reuse the reader's deterministic reconstruction of split table rows. This only
    # reassembles source fragments (e.g. a wrapped rate or article code), not LLM text.
    if "|" in text:
        from .local_pipeline import _extract_markdown_tables

        windows.extend(
            row
            for table in _extract_markdown_tables(text)
            if not table.is_summary_table
            for row in table.data_rows
        )
    return list(dict.fromkeys(windows))


def _contains(value: str, text: str) -> bool:
    # Allow punctuation/line-wrap normalization, but not "rat" inside "corporation".
    words = re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold())
    joined, starts, ends = "", set(), set()
    for word in words:
        starts.add(len(joined))
        joined += word
        ends.add(len(joined))
    key = compact(value)
    if not key:
        return False
    offset = joined.find(key)
    while offset >= 0:
        if offset in starts and offset + len(key) in ends:
            return True
        offset = joined.find(key, offset + 1)
    return False


def _identity_present(description: str | None, code: str | None, text: str) -> bool:
    if code and not _contains(code, text):
        return False
    if description:
        if len(compact(description)) < 3:
            return False
        if not _contains(description, text):
            # A description can combine printed fragments, never unsupported words.
            words = re.findall(r"\w+", unicodedata.normalize("NFKC", description).casefold())
            if not words or not all(_contains(word, text) for word in words):
                return False
    return bool(description or code)


def ground_extraction(record: InvoiceRecord, document: ParsedDocument) -> InvoiceRecord:
    """Reject unsupported items/values before computed defaults or price checking.

    OCR is evidence, not truth: passing this gate does not certify handwriting accuracy.
    Unresolved OCR warnings remain on the checking record for manual review.
    """
    source = document.markdown
    windows = _windows(source)
    references = []
    for index, line in enumerate(record.lines, 1):
        if compact(line.description or "") in {"thankyou", "thankyouforyourbusiness"}:
            raise ValueError(f"Line {index} is not a supported invoice item; review required")
        matches = [w for w in windows if _identity_present(line.description, line.part_number, w)]
        if not matches:
            raise ValueError(f"Line {index} has no supporting source text; review required")
        values = {
            Decimal(v) for v in (line.quantity, line.unit_price, line.line_total) if v is not None
        }
        matching_values = [w for w in matches if values <= source_numbers(w)]
        if not matching_values:
            raise ValueError(
                f"Line {index} contains numbers not present with the item; review required"
            )
        evidence = matching_values[0]
        # Context fields that affect calculation must also come from the same row.
        for field in ("exchange_rate", "discount_amount", "discount_rate"):
            value = getattr(line, field, None)
            if value is not None:
                expected = Decimal(value) * (100 if field == "discount_rate" else 1)
                supported = (
                    percentages(evidence) if field == "discount_rate" else source_numbers(evidence)
                )
                if expected not in supported:
                    raise ValueError(f"Line {index} has unsupported {field}; review required")
        references.append(
            {"line": index, "source_text": evidence, "fields": line.model_dump(exclude_none=True)}
        )

    # Summary values may be elsewhere on the page; never replace them with computed values.
    printed_numbers = source_numbers(source)
    for field in ("subtotal", "tax", "invoice_total"):
        value = getattr(record, field)
        if value is not None and Decimal(value) not in printed_numbers:
            raise ValueError(f"Extracted {field} has no source evidence; review required")
    for field in ("supplier_name", "invoice_number", "purchase_order"):
        value = getattr(record, field, None)
        if value and compact(value) not in compact(source):
            raise ValueError(f"Extracted {field} has no source evidence; review required")
    currency_aliases = {"SGD": ("SGD", "S$"), "USD": ("USD", "US$"), "CNY": ("CNY", "RMB")}
    for currency in [record.currency, *(getattr(line, "currency", None) for line in record.lines)]:
        if currency and not any(
            re.search(r"(?<!\w)" + re.escape(alias) + r"(?![A-Za-z])", source, re.I)
            for alias in currency_aliases.get(currency, (currency,))
        ):
            raise ValueError("Extracted currency has no source evidence; review required")
    if record.invoice_date:
        try:
            value = date.fromisoformat(record.invoice_date)
        except ValueError as exc:
            raise ValueError("Invalid extracted invoice date; review required") from exc
        forms = [
            value.isoformat(),
            f"{value.day}/{value.month}/{value.year}",
            f"{value.day:02}/{value.month:02}/{value.year}",
            f"{value.month}/{value.day}/{value.year}",
            f"{value.month:02}/{value.day:02}/{value.year}",
            f"{value.day} {value:%b} {value.year}",
            f"{value.day} {value:%B} {value.year}",
            f"{value:%B} {value.day} {value.year}",
            f"{value:%b} {value.day} {value.year}",
        ]
        if not any(compact(form) in compact(source) for form in forms):
            raise ValueError("Extracted invoice_date has no source evidence; review required")
    if record.invoice_date:
        numeric_dates = re.findall(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)", source)
        if any(
            1 <= int(a) <= 12
            and 1 <= int(b) <= 12
            and a != b
            and record.invoice_date
            in (f"{year}-{int(a):02}-{int(b):02}", f"{year}-{int(b):02}-{int(a):02}")
            for a, b, year in numeric_dates
        ):
            record.invoice_date = None
            if hasattr(record, "warnings"):
                record.warnings.append("Ambiguous numeric invoice date; human review required")
    tax_rate = getattr(record, "tax_rate", None)
    if tax_rate is not None and Decimal(tax_rate) * 100 not in percentages(source):
        raise ValueError("Extracted tax_rate has no source evidence; review required")
    for index, line in enumerate(record.lines, 1):
        unit = getattr(line, "unit", None)
        if unit and not re.search(r"(?<!\w)" + re.escape(unit) + r"(?!\w)", source, re.I):
            raise ValueError(f"Line {index} has unsupported unit; review required")
    document.docling_document["extraction_evidence"] = references
    return record


def preserve_supported_numbers(
    original: InvoiceRecord, revised: InvoiceRecord, document: ParsedDocument
) -> None:
    """A critique may recover missing evidence, but may not repair printed arithmetic."""
    printed = source_numbers(document.markdown)
    for field in ("subtotal", "tax", "invoice_total"):
        value = getattr(original, field)
        if value is not None and Decimal(value) in printed:
            setattr(revised, field, value)
    windows = _windows(document.markdown)
    for index, (before, after) in enumerate(zip(original.lines, revised.lines)):
        if compact(before.description or "") != compact(after.description or ""):
            continue
        matches = [
            w for w in windows if _identity_present(before.description, before.part_number, w)
        ]
        for field in ("quantity", "unit_price", "line_total", "discount_amount", "exchange_rate"):
            value = getattr(before, field, None)
            if value is not None and any(Decimal(value) in source_numbers(w) for w in matches):
                setattr(after, field, value)
