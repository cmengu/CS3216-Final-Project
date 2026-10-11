from copy import deepcopy
from decimal import ROUND_HALF_UP, Decimal

CATALOG = [
    {
        "part_number": "RES-0603-10K",
        "description": "Resistor 10k ohm 0603",
        "currency": "SGD",
        "unit_price": "0.012",
    },
    {
        "part_number": "CAP-0402-100N",
        "description": "Ceramic capacitor 100nF 0402",
        "currency": "SGD",
        "unit_price": "0.0047",
    },
    {
        "part_number": "IC-LDO-33",
        "description": "Voltage regulator 3.3V SOT-23",
        "currency": "SGD",
        "unit_price": "0.185",
    },
    {
        "part_number": "DIO-SCH-40V",
        "description": "Schottky diode 40V",
        "currency": "SGD",
        "unit_price": "0.032",
    },
    {
        "part_number": "CON-2X5",
        "description": "Connector 2x5 pin header",
        "currency": "SGD",
        "unit_price": "0.420",
    },
    {
        "part_number": "XTAL-16MHZ",
        "description": "Crystal oscillator 16MHz",
        "currency": "SGD",
        "unit_price": "0.275",
    },
]


def money(value):
    return str(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def build_cases():
    """Construct known fixtures from source data. This is not Kalent's runtime checker."""
    cases = []
    for index in range(1, 11):
        items = CATALOG[:3] if index < 7 else CATALOG[3:]
        lines = [
            {
                "part_number": p["part_number"],
                "description": p["description"],
                "quantity": str(q),
                "unit_price": p["unit_price"],
                "line_total": money(Decimal(p["unit_price"]) * q),
            }
            for p, q in zip(items, [5000, 10000, 2000])
        ]
        if index == 10:
            lines = deepcopy(lines * 12)  # Table continuation across multiple pages.
        results = [
            {
                "line_index": i,
                "status": "match",
                "reason": "Agreed unit price",
                "invoice_price": line["unit_price"],
                "agreed_price": line["unit_price"],
                "difference": "0",
                "overcharge": "0.00",
            }
            for i, line in enumerate(lines)
        ]
        mistakes = []
        if index in (2, 6, 8):
            line = lines[0]
            agreed = Decimal(line["unit_price"])
            price = agreed + (Decimal("-0.001") if index == 8 else Decimal("0.003"))
            line["unit_price"] = str(price)
            line["line_total"] = money(price * Decimal(line["quantity"]))
            difference = price - agreed
            results[0].update(
                status="price_mismatch",
                reason="Billed unit price differs from agreed price",
                invoice_price=str(price),
                difference=str(difference),
                overcharge=money(max(difference, Decimal(0)) * Decimal(line["quantity"])),
            )
            mistakes.append({"type": "unit_price_difference", "line_index": 0})
        if index in (3, 6):
            lines[1]["part_number"] = "UNKNOWN-DEMO-PART"
            results[1].update(
                status="unknown_part",
                reason="Part is not on the price sheet",
                agreed_price=None,
                difference=None,
                overcharge=None,
            )
            mistakes.append({"type": "unknown_part", "line_index": 1})
        if index in (3, 4):
            lines[2]["line_total"] = money(Decimal(lines[2]["line_total"]) + 1)
            results[2].update(
                status="needs_person",
                reason="Quantity times price does not equal line total",
                overcharge=None,
            )
            mistakes.append({"type": "line_arithmetic", "line_index": 2})
        subtotal = sum(Decimal(line["line_total"]) for line in lines)
        if index == 9:
            subtotal += 1
            mistakes.append({"type": "subtotal_arithmetic", "line_index": None})
        tax = Decimal(money(subtotal * Decimal("0.09")))
        total = subtotal + tax
        if index == 5:
            total += 1
            mistakes.append({"type": "invoice_total_arithmetic", "line_index": None})
        warnings = []
        if index in (5, 9):
            warnings.append("Invoice arithmetic does not reconcile")
            for result in results:
                result.update(status="needs_person", reason=warnings[0], overcharge=None)
            overcharge_total = None
        else:
            # The total is the overcharges that are known; unpriced lines are counted beside it.
            known = [Decimal(r["overcharge"]) for r in results if r["overcharge"] is not None]
            unpriced = len(results) - len(known)
            if unpriced:
                warnings.append(f"{unpriced} line{'' if unpriced == 1 else 's'} not priced")
            overcharge_total = money(sum(known, Decimal(0)))
        invoice = {
            "supplier_name": [
                "Demo Circuit Supplies",
                "Invented Silicon Trading",
                "Sample Components Lab",
            ][(index - 1) % 3],
            "invoice_number": f"DEMO-{index:03}",
            "invoice_date": f"2026-10-{index:02}",
            "currency": "SGD",
            "subtotal": money(subtotal),
            "tax": money(tax),
            "invoice_total": money(total),
            "lines": lines,
        }
        cases.append(
            {
                "id": f"invoice-{index:02}",
                "layout": (index - 1) % 3,
                "invoice": invoice,
                "mistakes": mistakes,
                "expected_check": {
                    "lines": results,
                    "warnings": warnings,
                    "overcharge_total": overcharge_total,
                },
            }
        )
    return cases
