"""Live extraction and deterministic checks against an immutable CSV price snapshot.

No answer-key access, filename lookup, fuzzy part matching, or implicit currency conversion.
"""

import csv
import hashlib
import io
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from extract.context import CheckingInvoice, CheckingLine
from extract.invoice import extract_with_usage, refine_with_usage
from read.models import ParsedDocument
from schema import InvoiceRecord

from .contracts import CheckResult, LineResult

D = Decimal
TOLERANCE = D("0.005")

CONTEXT_PROMPT = """
Also copy the purchase_order (PO/order reference), unit, tax_rate and discount_rate.
Represent explicit percentages as fractions: 5% is 0.05. Copy a printed monetary discount
into discount_amount. If only the amount is printed, discount_rate is null (not zero).
If no discount is printed, both discount fields are null; the checker verifies the arithmetic.
An explicit US$ means USD and an explicit S$ means SGD; a bare $ remains ambiguous.
An explicitly labelled 'Article no.' or 'Stock Code' is a printed part_number even when
it appears inside the description column. Do not use an unlabelled row/mark number (such as
101-1 or 102-1) as a SKU/part_number.
For line currency, use the explicit currency of that line's unit price, otherwise the
explicit invoice currency. exchange_rate is the printed multiplier from line currency
to invoice currency; null if no conversion is printed. Never calculate converted prices.
flat_charge is true ONLY for a clearly flat service/freight fee, not a product missing a price.
Leave unprinted quantity, unit and unit_price null even for flat charges.
A monetary amount on a flat fee is not a unit price: mark the fee flat_charge=true even
when a foreign-currency fee amount and its conversion rate are printed without a quantity.
Keep the charge description separate from quantity, rate, currency and conversion details:
e.g. 'Freight - 2.40 M3 @ USD 85.00/M3' has description 'Freight'.
Do not invent product codes for freight, courier, or service descriptions without codes.
The invoice line_total is the printed billed amount in invoice currency after discount.
Return one row per charge, combining wrapped descriptions across OCR table rows.
Do not repeat header, subtotal, balance due or tax rows as charges. Preserve repeated items.
Add warnings ONLY when a value cannot be determined or arithmetic cannot be reconciled. Do not
warn when wrapped or merged OCR table rows can be unambiguously paired in sequence and reconcile
with printed line totals, nor when a flat fee lacks quantity/price, a discount is an amount
instead of a rate, or a document has multiple pages. Never use non-numeric text in numeric fields: use null.
"""


def normalized(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def normalized_description(value: str | None) -> str:
    text = re.sub(r'(\d)\s*(?:""|["”″])', r"\1 inch ", value or "")
    return normalized(text)


def normalized_unit(value: str | None) -> str:
    return normalized(value).replace("³", "3").replace("²", "2")


def money(value: Decimal) -> Decimal:
    return value.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def flat_charge(invoice, line, candidates):
    """Recognize a code-free per-JOB fee only when its printed amount reconciles."""
    if line.flat_charge:
        return True
    if line.quantity is not None or line.unit is not None:
        return False
    if line.unit_price is None:
        return True
    if line.part_number or len(candidates) != 1 or normalized_unit(candidates[0]["uom"]) != "job":
        return False
    if any(
        value is not None and D(value) != 0 for value in (line.discount_rate, line.discount_amount)
    ):
        return False
    if not line.currency or not invoice.currency or line.line_total is None:
        return False
    price = D(line.unit_price)
    if line.currency != invoice.currency:
        if line.exchange_rate is None or D(line.exchange_rate) <= 0:
            return False
        price *= D(line.exchange_rate)
    elif line.exchange_rate is not None and D(line.exchange_rate) != 1:
        return False
    return money(price) == D(line.line_total)


class PriceSheet:
    @classmethod
    def from_master(cls, document):
        """Adapt confirmed import fields; missing agreement terms remain missing."""
        sheet = cls.__new__(cls)
        sheet.version = document["version"]
        sheet.rows = [
            {
                "key": str(index),
                "supplier": item.get("supplier"),
                "po": item.get("po"),
                "item": item.get("item"),
                "description": item.get("description") or item["name"],
                "uom": item.get("unit"),
                "currency": item["currency"].upper() if item.get("currency") else None,
                "unit_price": item["price"],
                "discount": str(item["discount"]) if item.get("discount") is not None else None,
                "tax": str(item["tax"]) if item.get("tax") is not None else None,
                "valid_from": item.get("validFrom"),
                "valid_to": item.get("validTo"),
            }
            for index, item in enumerate(document["items"])
        ]
        return sheet

    def __init__(self, path: Path):
        data = path.read_bytes()
        self.version = hashlib.sha256(data).hexdigest()
        self.rows = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
        required = {
            "key",
            "supplier",
            "po",
            "item",
            "description",
            "uom",
            "currency",
            "unit_price",
            "discount",
            "tax",
            "valid_from",
            "valid_to",
        }
        if not self.rows or not required <= self.rows[0].keys():
            raise ValueError("Price CSV is empty or missing required columns")
        keys = set()
        for row in self.rows:
            if any(not row[column] for column in required) or row["key"] in keys:
                raise ValueError("Price CSV has empty fields or duplicate keys")
            keys.add(row["key"])
            for column in ("unit_price", "discount", "tax"):
                value = D(row[column])
                if not value.is_finite() or value < 0:
                    raise ValueError("Price CSV has an invalid numeric value")
            if D(row["discount"]) > 1 or D(row["tax"]) > 1:
                raise ValueError("Price CSV rates must be fractions between zero and one")
            if date.fromisoformat(row["valid_from"]) > date.fromisoformat(row["valid_to"]):
                raise ValueError("Price CSV has an invalid validity interval")

    def check(self, invoice: CheckingInvoice) -> CheckResult:
        results = [self._line(invoice, line, i) for i, line in enumerate(invoice.lines)]
        warnings = list(invoice.warnings)
        if not results:
            warnings.append("No invoice lines extracted; human review required")
        amounts = [D(line.line_total) for line in invoice.lines if line.line_total is not None]
        if len(amounts) == len(invoice.lines) and invoice.subtotal is not None:
            if abs(sum(amounts, D(0)) - D(invoice.subtotal)) > D("0.01"):
                warnings.append("Line amounts do not reconcile with subtotal")
        if all(x is not None for x in (invoice.subtotal, invoice.tax, invoice.invoice_total)):
            if abs(D(invoice.subtotal) + D(invoice.tax) - D(invoice.invoice_total)) > D("0.01"):
                warnings.append("Subtotal plus tax does not reconcile with invoice total")
        if (
            invoice.tax_rate is not None
            and invoice.subtotal is not None
            and invoice.tax is not None
        ):
            if abs(money(D(invoice.subtotal) * D(invoice.tax_rate)) - D(invoice.tax)) > D("0.01"):
                warnings.append("Printed tax does not reconcile with the stated tax rate")
        complete = bool(results) and not warnings and all(r.overcharge is not None for r in results)
        return CheckResult(
            price_sheet_version=self.version,
            lines=results,
            overcharge_total=str(sum((D(r.overcharge) for r in results), D("0.00")))
            if complete
            else None,
            warnings=warnings,
        )

    def _line(self, invoice: CheckingInvoice, line: CheckingLine, index: int) -> LineResult:
        def review(reason, status="needs_person"):
            return LineResult(
                line_index=index,
                status=status,
                reason=reason,
                invoice_price=line.unit_price,
                agreed_price=None,
                difference=None,
                overcharge=None,
            )

        if not invoice.currency:
            return review("Invoice currency is missing")
        try:
            issued = date.fromisoformat(invoice.invoice_date) if invoice.invoice_date else None
        except ValueError:
            return review("Invalid invoice date")
        scoped = [
            r
            for r in self.rows
            if (not r["supplier"] or normalized(r["supplier"]) == normalized(invoice.supplier_name))
            and (not r["po"] or normalized(r["po"]) == normalized(invoice.purchase_order))
            and (not r["currency"] or r["currency"] == invoice.currency)
            and (
                not r["valid_from"]
                or issued is not None
                and date.fromisoformat(r["valid_from"]) <= issued
            )
            and (
                not r["valid_to"]
                or issued is not None
                and issued <= date.fromisoformat(r["valid_to"])
            )
        ]
        if not scoped:
            return review("No valid price agreement for supplier, PO, currency and date")
        part_code = line.part_number.strip() if line.part_number else None
        candidates = [
            r
            for r in scoped
            if (
                re.sub(r"\s+", "", r["item"]).casefold() == re.sub(r"\s+", "", part_code).casefold()
                if part_code and r["item"]
                else normalized_description(r["description"])
                == normalized_description(line.description)
            )
        ]
        if not candidates:
            return review("Not exist in Master Sheet", "unknown_part")
        is_flat = flat_charge(invoice, line, candidates)
        unit = line.unit or ("JOB" if is_flat else None)
        if any(not r["currency"] or not r["uom"] for r in candidates):
            return review("Master list needs currency and unit before this line can be compared")
        candidates = [r for r in candidates if normalized_unit(r["uom"]) == normalized_unit(unit)]
        if len(candidates) != 1:
            return review("Missing/mismatched unit or ambiguous price agreement")
        master = candidates[0]
        agreed_discount = D(master["discount"]) if master["discount"] is not None else None
        if (
            line.discount_rate is None
            and line.discount_amount is None
            and agreed_discount not in (None, D(0))
        ):
            return review("Missing discount information")
        discount = (
            (agreed_discount or D(0)) if line.discount_rate is None else D(line.discount_rate)
        )
        if (
            not D(0) <= discount <= D(1)
            or agreed_discount is not None
            and discount != agreed_discount
        ):
            return review("Invoice discount differs from the agreement")
        if (
            master["tax"] is not None
            and invoice.tax_rate is not None
            and D(invoice.tax_rate) != D(master["tax"])
        ):
            return review("Invoice tax rate differs from the agreement")
        quantity = D(line.quantity) if line.quantity is not None else None
        price = D(line.unit_price) if line.unit_price is not None else None
        billed_flat_amount = False
        if is_flat and normalized_unit(master["uom"]) == "job":
            quantity = quantity if quantity is not None else D(1)
            # A flat billed amount is a per-JOB price only for one undiscounted job.
            if price is None and quantity == 1 and discount == 0 and line.line_total is not None:
                price = D(line.line_total)
                currency = invoice.currency
                billed_flat_amount = True
            else:
                currency = line.currency or invoice.currency
        else:
            currency = line.currency
        if price is None or quantity is None or quantity <= 0 or price < 0:
            return review("Missing/invalid quantity or price")
        if not currency:
            return review("Unit-price currency is unknown")
        if currency != invoice.currency:
            if line.exchange_rate is None or D(line.exchange_rate) <= 0:
                return review("Currency conversion requires an explicit printed exchange rate")
            price *= D(line.exchange_rate)
        elif (
            not billed_flat_amount and line.exchange_rate is not None and D(line.exchange_rate) != 1
        ):
            return review("Unexpected exchange rate for a same-currency price")
        if line.line_total is None:
            return review("Missing printed line amount")
        expected_discount = money(quantity * price * discount)
        known_discount_rate = agreed_discount is not None or line.discount_rate is not None
        if (
            known_discount_rate
            and line.discount_amount is not None
            and abs(D(line.discount_amount) - expected_discount) > D("0.01")
        ):
            return review("Printed discount amount differs from the agreement")
        actual_discount = (
            D(line.discount_amount) if line.discount_amount is not None else expected_discount
        )
        actual_amount = money(quantity * price) - actual_discount
        if abs(actual_amount - D(line.line_total)) > D("0.01"):
            return review(
                "Quantity, price and discount do not reconcile with the billed line amount"
            )
        agreed = D(master["unit_price"])
        difference = price - agreed
        mismatch = abs(difference) > TOLERANCE
        expected_amount = money(quantity * agreed) - (
            money(quantity * agreed * discount) if known_discount_rate else actual_discount
        )
        overcharge = max(D(0), actual_amount - expected_amount) if mismatch else D(0)
        return LineResult(
            line_index=index,
            status="price_mismatch" if mismatch else "match",
            reason="Unit price differs by more than 0.005"
            if mismatch
            else "Unit price matches agreement",
            invoice_price=format(price, "f"),
            agreed_price=format(agreed, "f"),
            difference=format(difference, "f"),
            overcharge=str(money(overcharge)),
        )

    def catalog_grounding_hints(self, invoice: CheckingInvoice) -> list[dict[str, str]]:
        """Return strictly price-free catalog items (never unit_price, discount, or tax)."""
        po_norm = normalized(invoice.purchase_order)
        sup_norm = normalized(invoice.supplier_name)
        matched = [
            r
            for r in self.rows
            if (not r["po"] or po_norm and normalized(r["po"]) == po_norm)
            and (not r["supplier"] or sup_norm and normalized(r["supplier"]) == sup_norm)
        ]
        seen = set()
        hints = []
        for r in matched:
            sig = (r["supplier"], r["po"], r["item"], r["description"], r["uom"])
            if sig not in seen:
                seen.add(sig)
                hints.append(
                    {
                        "supplier": r["supplier"],
                        "po": r["po"],
                        "item": r["item"],
                        "description": r["description"],
                        "uom": r["uom"],
                    }
                )
        return hints

    def verify_extraction(self, invoice: CheckingInvoice) -> list[str]:
        """Deterministic self-verification critic for agentic reflection."""
        critique: list[str] = []
        if not invoice.supplier_name:
            critique.append("Header supplier_name is missing; check printed supplier header.")
        if not invoice.invoice_number:
            critique.append("Header invoice_number is missing; check printed invoice number.")
        if not invoice.invoice_date:
            critique.append("Header invoice_date is missing or not in YYYY-MM-DD format.")
        if not invoice.currency:
            critique.append("Header currency is missing; check explicit SGD/USD/S$/US$ markers.")
        if not invoice.lines:
            critique.append("No line items were extracted from the invoice.")

        hints = self.catalog_grounding_hints(invoice)
        known_items = {re.sub(r"\s+", "", h["item"]).casefold() for h in hints if h["item"]}
        known_descs = {normalized_description(h["description"]) for h in hints}
        need_catalog_hint = False

        for idx, line in enumerate(invoice.lines):
            label = line.part_number or line.description or f"row {idx + 1}"
            line_hints = [
                h
                for h in hints
                if normalized_description(h["description"])
                == normalized_description(line.description)
            ]
            is_flat = flat_charge(invoice, line, line_hints)
            if not line.description:
                critique.append(f"Line {idx + 1} is missing its item description.")
            if line.line_total is None:
                critique.append(f"Line {idx + 1} ({label}) is missing line_total.")
            if not is_flat and (line.quantity is None or line.unit_price is None):
                critique.append(f"Line {idx + 1} ({label}) is missing quantity or unit_price.")
            elif (
                line.quantity is not None
                and line.unit_price is not None
                and line.line_total is not None
            ):
                qty = D(line.quantity)
                price = D(line.unit_price)
                if (
                    line.currency
                    and invoice.currency
                    and line.currency != invoice.currency
                    and line.exchange_rate is not None
                ):
                    price *= D(line.exchange_rate)
                disc_rate = D(line.discount_rate) if line.discount_rate is not None else D(0)
                disc_amt = (
                    D(line.discount_amount)
                    if line.discount_amount is not None
                    else money(qty * price * disc_rate)
                )
                expected_line = money(qty * price) - disc_amt
                billed_line = D(line.line_total)
                if abs(expected_line - billed_line) > D("0.01"):
                    hint_ratio = ""
                    if price > 0:
                        implied_qty = billed_line / price
                        if implied_qty == implied_qty.to_integral_value():
                            hint_ratio = f" (note: {billed_line} / {price} = {int(implied_qty)})"
                    critique.append(
                        f"Line {idx + 1} ({label}): quantity ({line.quantity}) * unit_price "
                        f"({line.unit_price}) minus discount gives {expected_line}, which does not "
                        f"reconcile with printed line_total ({line.line_total}){hint_ratio}. "
                        f"Re-read the printed quantity, unit_price, and line_total."
                    )

            if hints:
                part_code = (
                    None
                    if not line.part_number
                    else re.sub(r"\s+", "", line.part_number).casefold()
                )
                desc_norm = normalized_description(line.description)
                code_free_description = any(
                    not h["item"] and normalized_description(h["description"]) == desc_norm
                    for h in hints
                )
                if part_code and part_code not in known_items and not code_free_description:
                    need_catalog_hint = True
                    critique.append(
                        f"Line {idx + 1}: extracted part_number '{line.part_number}' does not match "
                        f"any known catalog code for this supplier/PO; check for OCR typos."
                    )
                elif not part_code and desc_norm not in known_descs:
                    need_catalog_hint = True
                    critique.append(
                        f"Line {idx + 1}: extracted description '{line.description}' does not match "
                        f"any known catalog description for this supplier/PO; check for garbled OCR."
                    )

        amounts = [D(line.line_total) for line in invoice.lines if line.line_total is not None]
        if invoice.lines and len(amounts) == len(invoice.lines) and invoice.subtotal is not None:
            if abs(sum(amounts, D(0)) - D(invoice.subtotal)) > D("0.01"):
                critique.append(
                    f"Sum of line_total values ({sum(amounts, D(0))}) does not reconcile with "
                    f"printed subtotal ({invoice.subtotal}). Check for missed, duplicated, or misread lines."
                )
        if all(x is not None for x in (invoice.subtotal, invoice.tax, invoice.invoice_total)):
            if abs(D(invoice.subtotal) + D(invoice.tax) - D(invoice.invoice_total)) > D("0.01"):
                critique.append(
                    f"Printed subtotal ({invoice.subtotal}) + tax ({invoice.tax}) does not "
                    f"reconcile with invoice_total ({invoice.invoice_total})."
                )
        if invoice.warnings:
            critique.append(
                f"Initial extraction recorded warnings {invoice.warnings}; verify against the "
                f"document text/image and clear warnings if all fields are resolved."
            )
        if need_catalog_hint and hints:
            catalog_lines = [
                f"  * item={h['item']} | description={h['description']} | uom={h['uom']}"
                for h in hints
            ]
            critique.append(
                "Known catalog items (price-free) for this supplier/PO to help disambiguate OCR typos:\n"
                + "\n".join(catalog_lines)
            )
        return critique


class LiveStages:
    mode = "live"

    def __init__(self, price_sheet: Path | PriceSheet, *, model: str, client=None):
        if not model.strip():
            raise ValueError("Set OPENAI_MODEL for live extraction")
        self.sheet = price_sheet if isinstance(price_sheet, PriceSheet) else PriceSheet(price_sheet)
        self.price_sheet_version = self.sheet.version
        self.model, self.client = model, client

    def extract(self, document: ParsedDocument) -> CheckingInvoice:
        result = extract_with_usage(
            document,
            client=self.client,
            model=self.model,
            record_type=CheckingInvoice,
            extra_instructions=CONTEXT_PROMPT,
        )
        record = result.record
        if not isinstance(record, CheckingInvoice):
            raise ValueError("Live extraction returned no checking context")
        critique = self.sheet.verify_extraction(record)
        if critique:
            try:
                refined = refine_with_usage(
                    document,
                    record,
                    critique,
                    client=self.client,
                    model=self.model,
                    record_type=CheckingInvoice,
                    extra_instructions=CONTEXT_PROMPT,
                ).record
                if isinstance(refined, CheckingInvoice) and len(
                    self.sheet.verify_extraction(refined)
                ) <= len(critique):
                    record = refined
            except ValueError:
                pass
        record.warnings.extend(w for page in document.pages for w in page.warnings)
        return record

    def check(self, invoice: InvoiceRecord) -> CheckResult:
        if not isinstance(invoice, CheckingInvoice):
            raise ValueError("Live checking requires printed PO, unit and currency context")
        return self.sheet.check(invoice)
