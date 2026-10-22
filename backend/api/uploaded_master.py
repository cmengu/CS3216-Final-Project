"""Invoice checking against a single uploaded, immutable master-list snapshot."""

import json
from datetime import date
from decimal import Decimal as D

from .contracts import LineResult
from .csv_live import TOLERANCE, LiveStages, PriceSheet, money, normalized, normalized_description


class UploadedPriceSheet(PriceSheet):
    def __init__(self, document):
        self.version = document["version"]
        self.items = document["items"]
        # Price-free extraction hints use the same uploaded snapshot as checking.
        self.rows = [
            {
                "supplier": i.get("supplier") or "",
                "po": i.get("po") or "",
                "item": i.get("item") or i["name"],
                "description": i.get("description") or i["name"],
                "uom": i.get("unit") or "",
            }
            for i in self.items
        ]

    def _line(self, invoice, line, index):
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

        def matches(item):
            names = [item["name"], item.get("item"), item.get("description")]
            return any(
                value
                and (
                    (line.part_number and normalized(value) == normalized(line.part_number))
                    or normalized_description(value) == normalized_description(line.description)
                )
                for value in names
            )

        candidates = [i for i in self.items if matches(i)]
        if not candidates:
            return review("Not exist in Master Sheet", "unknown_part")
        scoped = []
        for item in candidates:
            if any(
                item.get(k) and normalized(item[k]) != normalized(value)
                for k, value in (
                    ("supplier", invoice.supplier_name),
                    ("po", invoice.purchase_order),
                    ("unit", line.unit),
                    ("currency", line.currency or invoice.currency),
                )
            ):
                continue
            if item.get("validFrom") or item.get("validTo"):
                try:
                    issued = date.fromisoformat(invoice.invoice_date or "")
                    if item.get("validFrom") and issued < date.fromisoformat(item["validFrom"]):
                        continue
                    if item.get("validTo") and issued > date.fromisoformat(item["validTo"]):
                        continue
                except ValueError:
                    continue
            scoped.append(item)
        if len(scoped) != 1:
            return review("No unique uploaded master-list entry matches the invoice context")
        item = scoped[0]
        quantity = D(line.quantity) if line.quantity is not None else None
        if item.get("quantity") is not None and quantity != D(item["quantity"]):
            return review("Quantity differs from the uploaded master list")
        price = D(line.unit_price) if line.unit_price is not None else None
        if (
            price is None
            and line.flat_charge
            and line.line_total is not None
            and quantity in (None, D(1))
        ):
            price = D(line.line_total)
            quantity = D(1)
        if price is None or price < 0:
            return review("Missing or invalid unit price")
        if quantity is None or quantity <= 0 or line.line_total is None:
            return review("Missing or invalid quantity or line amount")
        currency = line.currency or invoice.currency
        if not currency or not invoice.currency:
            return review("Invoice price currency is unknown")
        conversion = D(1)
        if currency != invoice.currency:
            if line.exchange_rate is None or D(line.exchange_rate) <= 0:
                return review("Currency conversion requires an explicit printed exchange rate")
            conversion = D(line.exchange_rate)
        elif line.exchange_rate is not None and D(line.exchange_rate) != 1:
            return review("Unexpected exchange rate for a same-currency price")
        rate = D(line.discount_rate) if line.discount_rate is not None else D(0)
        if item.get("discount") is not None:
            expected_rate = D(str(item["discount"]))
            if expected_rate != 0 and line.discount_rate is None and line.discount_amount is None:
                return review("Missing printed discount information")
            if line.discount_rate is not None and rate != expected_rate:
                return review("Discount differs from the uploaded master list")
            rate = expected_rate
        if not D(0) <= rate <= D(1):
            return review("Invalid discount rate")
        gross = money(quantity * price * conversion)
        discount = (
            D(line.discount_amount) if line.discount_amount is not None else money(gross * rate)
        )
        if discount < 0 or discount > gross:
            return review("Invalid discount amount")
        if (item.get("discount") is not None or line.discount_rate is not None) and abs(
            discount - money(gross * rate)
        ) > D("0.01"):
            return review("Printed discount does not reconcile with the discount rate")
        if abs(gross - discount - D(line.line_total)) > D("0.01"):
            return review(
                "Quantity, price and discount do not reconcile with the billed line amount"
            )
        agreed = D(item["price"])
        difference = price - agreed
        mismatch = abs(difference) > TOLERANCE
        # Percentage discounts scale with price; fixed monetary discounts stay fixed.
        agreed_gross = money(quantity * agreed * conversion)
        agreed_discount = (
            money(agreed_gross * rate)
            if item.get("discount") is not None or line.discount_rate is not None
            else discount
        )
        overcharge = (
            max(D(0), D(line.line_total) - (agreed_gross - agreed_discount)) if mismatch else D(0)
        )
        return LineResult(
            line_index=index,
            status="price_mismatch" if mismatch else "match",
            reason="Unit price differs from uploaded master list"
            if mismatch
            else "Matches uploaded master list",
            invoice_price=str(price),
            agreed_price=str(agreed),
            difference=str(difference),
            overcharge=str(money(overcharge)),
        )


class UploadedMasterStages:
    mode = "live"

    def __init__(self, store, model):
        if not model.strip():
            raise ValueError("Set OPENAI_MODEL for live extraction")
        self.store, self.model = store, model

    def snapshot(self):
        with self.store.connect() as db:
            row = db.execute(
                "SELECT document FROM master_lists ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
        if row is None:
            raise ValueError("Upload a master list before processing invoices")
        return LiveStages(UploadedPriceSheet(json.loads(row["document"])), model=self.model)
