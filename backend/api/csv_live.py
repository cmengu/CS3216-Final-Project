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
from extract.invoice import extract_with_usage
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
it appears inside the description column. Do not use an unlabelled row/mark number as a SKU.
For line currency, use the explicit currency of that line's unit price, otherwise the
explicit invoice currency. exchange_rate is the printed multiplier from line currency
to invoice currency; null if no conversion is printed. Never calculate converted prices.
flat_charge is true ONLY for a clearly flat service/freight fee, not a product missing a price.
Leave unprinted quantity, unit and unit_price null even for flat charges.
Keep the charge description separate from quantity, rate, currency and conversion details:
e.g. 'Freight - 2.40 M3 @ USD 85.00/M3' has description 'Freight'.
Do not invent product codes for freight, courier, or service descriptions without codes.
The invoice line_total is the printed billed amount in invoice currency after discount.
Return one row per charge, combining wrapped descriptions across OCR table rows.
Do not repeat header, subtotal, balance due or tax rows as charges. Preserve repeated items.
Add warnings for actual ambiguity, damaged OCR or uncertain row boundaries. Do not warn
merely because a flat fee lacks quantity/price, a discount is an amount instead of a rate,
or a document has multiple pages. Never use non-numeric text in numeric fields: use null.
"""


def normalized(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def money(value: Decimal) -> Decimal:
    return value.quantize(D("0.01"), rounding=ROUND_HALF_UP)


class PriceSheet:
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

        if not all(
            (invoice.supplier_name, invoice.purchase_order, invoice.currency, invoice.invoice_date)
        ):
            return review("Missing supplier, PO, currency or invoice date")
        try:
            issued = date.fromisoformat(invoice.invoice_date)
        except ValueError:
            return review("Invalid invoice date")
        scoped = [
            r
            for r in self.rows
            if normalized(r["supplier"]) == normalized(invoice.supplier_name)
            and normalized(r["po"]) == normalized(invoice.purchase_order)
            and r["currency"] == invoice.currency
            and date.fromisoformat(r["valid_from"]) <= issued <= date.fromisoformat(r["valid_to"])
        ]
        if not scoped:
            return review("No valid price agreement for supplier, PO, currency and date")
        candidates = [
            r
            for r in scoped
            if (
                re.sub(r"\s+", "", r["item"]).casefold()
                == re.sub(r"\s+", "", line.part_number).casefold()
                if line.part_number
                else normalized(r["description"]) == normalized(line.description)
            )
        ]
        if not candidates:
            return review(
                "No exact item or code-free description match in the agreement", "unknown_part"
            )
        unit = line.unit or ("JOB" if line.flat_charge else None)
        candidates = [r for r in candidates if normalized(r["uom"]) == normalized(unit)]
        if len(candidates) != 1:
            return review("Missing/mismatched unit or ambiguous price agreement")
        master = candidates[0]
        if (
            line.discount_rate is None
            and line.discount_amount is None
            and D(master["discount"]) != 0
        ):
            return review("Missing discount information")
        discount = D(master["discount"]) if line.discount_rate is None else D(line.discount_rate)
        if not D(0) <= discount <= D(1) or discount != D(master["discount"]):
            return review("Invoice discount differs from the agreement")
        if invoice.tax_rate is not None and D(invoice.tax_rate) != D(master["tax"]):
            return review("Invoice tax rate differs from the agreement")
        quantity = D(line.quantity) if line.quantity is not None else None
        price = D(line.unit_price) if line.unit_price is not None else None
        billed_flat_amount = False
        if line.flat_charge and master["uom"] == "JOB":
            quantity = quantity if quantity is not None else D(1)
            # A flat billed amount is a per-JOB price only for one undiscounted job.
            if price is None and quantity == 1 and discount == 0 and line.line_total is not None:
                price = D(line.line_total)
                currency = invoice.currency
                billed_flat_amount = True
            else:
                currency = line.currency
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
        if line.discount_amount is not None and abs(
            D(line.discount_amount) - expected_discount
        ) > D("0.01"):
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
        expected_amount = money(quantity * agreed) - money(quantity * agreed * discount)
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


class LiveStages:
    mode = "live"

    def __init__(self, price_sheet: Path, *, model: str, client=None):
        if not model.strip():
            raise ValueError("Set OPENAI_MODEL for live extraction")
        self.sheet = PriceSheet(price_sheet)
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
        record.warnings.extend(w for page in document.pages for w in page.warnings)
        return record

    def check(self, invoice: InvoiceRecord) -> CheckResult:
        if not isinstance(invoice, CheckingInvoice):
            raise ValueError("Live checking requires printed PO, unit and currency context")
        return self.sheet.check(invoice)
