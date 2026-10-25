"""Parse tabular files without inventing missing prices, quantities or metadata."""

import csv
import io
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from openpyxl import load_workbook

from .master_mapping import suggest_layouts

MAX_ROWS = 10000
MAX_COLUMNS = 100
FIELDS = {
    "name": [
        "name",
        "product name",
        "item name",
        "description",
        "item description",
        "product",
        "material description",
    ],
    "price": [
        "price",
        "unit price",
        "unit cost",
        "rate",
        "agreed price",
        "agreed unit price",
        "cost",
    ],
    "quantity": [
        "quantity",
        "qty",
        "quantity agreed",
        "agreed quantity",
        "stock",
        "stock quantity",
    ],
    "supplier": ["supplier", "supplier name", "vendor", "vendor name"],
    "item": [
        "sku",
        "item",
        "item code",
        "item part code",
        "part code",
        "product code",
        "part number",
        "part no",
        "stock code",
    ],
    "description": ["description", "item description"],
    "po": ["po", "po number", "purchase order", "po reference"],
    "unit": ["unit", "uom", "unit of measure"],
    "currency": ["currency", "ccy"],
    "discount": ["discount", "discount rate"],
    "tax": ["tax", "tax rate", "gst", "gst rate"],
    "validFrom": ["valid from", "start date"],
    "validTo": ["valid to", "end date"],
}
REQUIRED = ("name", "price")


def text(value):
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    return str(value).strip()


def limited(rows):
    result = []
    for row in rows:
        if len(result) >= MAX_ROWS + 50:
            raise ValueError(f"Maximum {MAX_ROWS} data rows per worksheet")
        if len(row) > MAX_COLUMNS:
            raise ValueError(f"Maximum {MAX_COLUMNS} columns per worksheet")
        result.append([text(v) for v in row])
    return result


def read_tables(filename, data):
    suffix = filename.lower().rsplit(".", 1)[-1]
    if suffix == "csv":
        try:
            content = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                content = data.decode("utf-16")
            except UnicodeError as exc:
                raise ValueError("Save the CSV with UTF-8 encoding") from exc
        try:
            dialect = csv.Sniffer().sniff(content[:8192], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        tables = {"CSV": limited(csv.reader(io.StringIO(content), dialect, strict=True))}
    elif suffix == "xlsx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(info.file_size for info in archive.infolist()) > 50 * 1024 * 1024:
                raise ValueError("Expanded workbook exceeds 50 MB")
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
        try:
            if len(workbook.worksheets) > 20:
                raise ValueError("Maximum 20 worksheets")
            tables = {sheet.title: limited(sheet.values) for sheet in workbook.worksheets}
        finally:
            workbook.close()
    elif suffix == "xls":
        import xlrd

        workbook = xlrd.open_workbook(file_contents=data, on_demand=True)
        try:
            if workbook.nsheets > 20:
                raise ValueError("Maximum 20 worksheets")
            tables = {}
            for sheet in workbook.sheets():
                rows = (
                    [
                        xlrd.xldate_as_datetime(c.value, workbook.datemode)
                        if c.ctype == xlrd.XL_CELL_DATE
                        else c.value
                        for c in sheet.row(i)
                    ]
                    for i in range(sheet.nrows)
                )
                tables[sheet.name] = limited(rows)
        finally:
            workbook.release_resources()
    else:
        raise ValueError("Upload a .csv, .xlsx or .xls file")
    if not any(any(any(cell for cell in row) for row in rows) for rows in tables.values()):
        raise ValueError("The file is empty")
    return tables


def fallback_layout(rows):
    """Suggest only a unique header with known name/price labels and numeric data below."""
    candidates = []
    header_count = 0
    for header, row in enumerate(rows):
        headings = [re.sub(r"[^a-z0-9]+", " ", value.lower()).strip() for value in row]
        mapping = {}
        for field, aliases in FIELDS.items():
            matches = [i for i, heading in enumerate(headings) if heading in aliases]
            if len(matches) == 1:
                mapping[field] = matches[0]
        if not all(field in mapping for field in REQUIRED):
            continue
        if len({mapping[field] for field in REQUIRED}) != len(REQUIRED):
            continue
        header_count += 1
        data = [r for r in rows[header + 1 :] if any(r)][:3]
        if not data:
            continue
        try:
            for values in data:
                if (
                    len(values) <= max(mapping["name"], mapping["price"])
                    or not values[mapping["name"]].strip()
                ):
                    raise ValueError("Missing value")
                numeric(values[mapping["price"]], "Price")
        except ValueError:
            continue
        candidates.append((header, mapping))
    return candidates[0] if len(candidates) == 1 and header_count == 1 else None


def preview(tables):
    result = [
        {
            "name": name,
            "rows": rows[:50],
            "header": 0,
            "mapping": {},
            "mappingSource": "manual",
            "note": "",
        }
        for name, rows in tables.items()
        if any(any(row) for row in rows)
    ]
    try:
        layouts = suggest_layouts(result)
        for layout in layouts.sheets:
            target = result[layout.sheet]
            target["header"] = layout.header if layout.header is not None else 0
            target["mapping"] = {column.field: column.column for column in layout.columns}
            target["mappingSource"] = "ai" if layout.header is not None else "manual"
            target["note"] = layout.note or (
                "No table identified. Select the header and columns manually."
                if layout.header is None
                else ""
            )
    except ValueError as exc:
        for target in result:
            target["note"] = str(exc)
    for target in result:
        if target["mappingSource"] != "ai":
            fallback = fallback_layout(target["rows"])
            if fallback:
                target["header"], target["mapping"] = fallback
                target["note"] += (
                    " Header and columns suggested from spreadsheet labels; review before importing."
                )
            continue
        headings = [
            re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
            for value in target["rows"][target["header"]]
        ]
        for field, aliases in FIELDS.items():
            if field in target["mapping"]:
                continue
            matches = [index for index, heading in enumerate(headings) if heading in aliases]
            if len(matches) == 1:
                target["mapping"][field] = matches[0]
    return {"sheets": result, "fields": list(FIELDS), "required": list(REQUIRED)}


def numeric(value, label, *, fraction=False):
    raw = value.strip()
    percent = raw.endswith("%")
    if percent:
        if not fraction:
            raise ValueError(f"{label}: percentages are not allowed")
        raw = raw[:-1]
    if "," in raw:
        if not re.fullmatch(r"[+-]?\d{1,3}(,\d{3})+(\.\d+)?", raw):
            raise ValueError(f"{label}: ambiguous number; use a decimal point and no grouping")
        raw = raw.replace(",", "")
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError(f"{label}: enter a numeric value") from exc
    if not value.is_finite() or value < 0:
        raise ValueError(f"{label}: must be a finite non-negative number")
    if percent:
        value /= 100
    if fraction and value > 1:
        raise ValueError(f"{label}: use a fraction or a percentage (e.g. 0.05 or 5%)")
    return format(value, "f")


def normalize(tables, sheet=None, header=None, mapping=None):
    candidates = [{"name": name} for name, rows in tables.items() if any(any(row) for row in rows)]
    if sheet is None:
        if len(candidates) != 1:
            raise ValueError("Select the worksheet to import")
        sheet = candidates[0]["name"]
    if sheet not in tables:
        raise ValueError("Worksheet not found")
    rows = tables[sheet]
    if header is None or mapping is None:
        proposed = preview({sheet: rows})["sheets"][0]
        if header is not None and header != proposed["header"]:
            raise ValueError("Provide column mappings for the selected header row")
        header = proposed["header"] if header is None else header
        mapping = proposed["mapping"] if mapping is None else mapping
    if header < 0 or header >= min(len(rows), 50):
        raise ValueError("Select a header row from the first 50 rows")
    for field, index in mapping.items():
        if field not in FIELDS or type(index) is not int or index < 0 or index >= len(rows[header]):
            raise ValueError("Invalid column mapping")
    for field in REQUIRED:
        if field not in mapping:
            raise ValueError(f"Select the {field} column")
    numeric_fields = [mapping[k] for k in ("name", "price", "quantity") if k in mapping]
    if len(set(numeric_fields)) != len(numeric_fields):
        raise ValueError("Name, price and quantity must use separate columns")
    items = []
    for row_number, row in enumerate(rows[header + 1 :], header + 2):
        if not any(row):
            continue
        item = {
            field: (row[index] or None) if index < len(row) else None
            for field, index in mapping.items()
        }
        item = {field: item.get(field) for field in FIELDS}
        for field in REQUIRED:
            if item[field] is None:
                raise ValueError(f"Row {row_number}: {field} is required")
        if item["name"].startswith("="):
            raise ValueError(f"Row {row_number}: name must be a value, not a formula")
        item["price"] = numeric(item["price"], f"Row {row_number}, price")
        if "quantity" in mapping:
            if item["quantity"] is None:
                raise ValueError(
                    f"Row {row_number}: quantity is empty. Supply a value or select None for quantity."
                )
            item["quantity"] = numeric(item["quantity"], f"Row {row_number}, quantity")
        # Undiscounted total; no-quantity entries are flat prices.
        item["totalPrice"] = (
            item["price"]
            if item["quantity"] is None
            else format(Decimal(item["price"]) * Decimal(item["quantity"]), "f")
        )
        for field in ("discount", "tax"):
            if item[field] is not None:
                item[field] = numeric(item[field], f"Row {row_number}, {field}", fraction=True)
        for field in ("validFrom", "validTo"):
            if item[field] is not None:
                try:
                    item[field] = date.fromisoformat(item[field]).isoformat()
                except ValueError as exc:
                    raise ValueError(f"Row {row_number}, {field}: use YYYY-MM-DD") from exc
        if item["validFrom"] and item["validTo"] and item["validFrom"] > item["validTo"]:
            raise ValueError(f"Row {row_number}: validFrom must not be after validTo")
        items.append(item)
        if len(items) > MAX_ROWS:
            raise ValueError(f"Maximum {MAX_ROWS} data rows")
    if not items:
        raise ValueError("No data rows below the selected header")
    return items
