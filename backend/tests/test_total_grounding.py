from types import SimpleNamespace

from extract.totals import ground_total_only_invoice


def test_total_cpt_does_not_turn_goods_amount_into_subtotal_or_invent_zero_tax():
    record = SimpleNamespace(subtotal="477.60", tax="0.00", tax_rate="0", invoice_total="506.20")
    ground_total_only_invoice(record, "| Copper | 477.60 |\n| Courier | 28.60 |\n| TOTAL CPT SINGAPORE: | 506.20 |")
    assert (record.subtotal, record.tax, record.tax_rate, record.invoice_total) == (None, None, None, "506.20")


def test_printed_subtotal_and_zero_tax_are_preserved():
    record = SimpleNamespace(subtotal="477.60", tax="0.00", invoice_total="506.20")
    ground_total_only_invoice(record, "Subtotal 477.60\nTax 0.00\nTOTAL CPT SINGAPORE 506.20")
    assert record.subtotal == "477.60"
    assert record.tax == "0.00"


def test_other_invoice_formats_are_unchanged():
    record = SimpleNamespace(subtotal="100", tax="9", invoice_total="109")
    ground_total_only_invoice(record, "Subtotal 100\nGST 9\nTotal 109")
    assert (record.subtotal, record.tax, record.invoice_total) == ("100", "9", "109")


def test_missing_subtotal_sums_every_line_including_courier_and_defaults_tax():
    from extract.totals import fill_missing_totals

    record = SimpleNamespace(subtotal=None, tax=None, lines=[
        SimpleNamespace(line_total="477.60"), SimpleNamespace(line_total="28.60")])
    fill_missing_totals(record)
    assert record.subtotal == "506.20"
    assert record.tax == "0.00"


def test_missing_line_amount_does_not_produce_partial_subtotal():
    from extract.totals import fill_missing_totals

    record = SimpleNamespace(subtotal=None, tax="9.00", lines=[SimpleNamespace(line_total=None)])
    fill_missing_totals(record)
    assert record.subtotal is None
    assert record.tax == "9.00"
