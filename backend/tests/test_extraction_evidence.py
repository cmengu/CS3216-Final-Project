import pytest

from extract.evidence import ground_extraction
from read.models import ParsedDocument
from schema import InvoiceLine, InvoiceRecord


def document(text):
    return ParsedDocument(
        document_hash="test",
        filename="test.pdf",
        page_count=1,
        reader_version="test",
        markdown=text,
        blocks=[],
        docling_document={},
    )


def record(description="Copper bus bar", **kwargs):
    line = InvoiceLine(
        part_number=None,
        description=description,
        quantity="12",
        unit_price="39.80",
        line_total="477.60",
    )
    for k, v in kwargs.items():
        setattr(line, k, v)
    return InvoiceRecord(
        supplier_name=None,
        invoice_number=None,
        invoice_date=None,
        currency=None,
        subtotal=None,
        tax=None,
        invoice_total=None,
        lines=[line],
    )


def test_prompt_products_rejected_even_if_schema_valid():
    with pytest.raises(ValueError, match="no supporting source"):
        ground_extraction(record("Resistor 10k ohm 0603"), document("Repair Sales Invoice 0002230"))


def test_supported_arithmetic_error_preserved():
    invoice = record(line_total="500.00")
    ground_extraction(invoice, document("| Copper bus bar | 12 | 39.80 | 500.00 |"))
    assert invoice.lines[0].line_total == "500.00"  # not 477.60


def test_cannot_borrow_price_from_another_table_row():
    with pytest.raises(ValueError, match="numbers not present"):
        ground_extraction(
            record(),
            document("| Copper bus bar | 12 | 20.00 | 240.00 |\n| Courier | 12 | 39.80 | 477.60 |"),
        )


def test_numeric_substring_is_not_evidence():
    with pytest.raises(ValueError, match="numbers not present"):
        ground_extraction(
            record("Module", quantity=None, unit_price=None, line_total="278"),
            document("Module S60278"),
        )


def test_wrapped_description_and_currency_prefix():
    invoice = record(
        "3M STRONG D.S.MOUNTING TAPE/OUTDOOR 19MMX1.5M",
        quantity="1",
        unit_price=None,
        line_total="13.20",
    )
    doc = document("1 3M STRONG D.S.MOUNTING T\nAPE/OUTDOOR 19MMX1.5M S$13.20")
    ground_extraction(invoice, doc)
    assert doc.docling_document["extraction_evidence"][0]["line"] == 1


def test_invented_header_rejected():
    invoice = record()
    invoice.supplier_name = "Invented Silicon Trading"
    with pytest.raises(ValueError, match="supplier_name"):
        ground_extraction(invoice, document("Copper bus bar 12 39.80 477.60"))


def test_refinement_must_not_fix_printed_math():
    from extract.evidence import preserve_supported_numbers

    original = record(line_total="500")
    revised = record(line_total="477.60")
    doc = document("| Copper bus bar | 12 | 39.80 | 500 |")
    preserve_supported_numbers(original, revised, doc)
    assert revised.lines[0].line_total == "500"
    ground_extraction(revised, doc)


def test_ambiguous_currency_not_inferred_from_corrupt_marker():
    invoice = record("Module", quantity=None, unit_price=None, line_total="278")
    invoice.currency = "SGD"
    with pytest.raises(ValueError, match="currency"):
        ground_extraction(invoice, document("Module S&D 278"))


def test_judge_prefers_source_over_mathematical_consistency():
    from extract.local_pipeline import _select_best_line

    printed = record(line_total="500").lines[0]
    calculated = record(line_total="477.60").lines[0]
    assert (
        _select_best_line(printed, calculated, "| Copper bus bar | 12 | 39.80 | 500 |") is printed
    )


def test_header_window_cannot_borrow_another_items_price():
    with pytest.raises(ValueError, match="numbers not present"):
        ground_extraction(
            record(),
            document(
                "Supplier\n"
                "| Copper bus bar | 12 | 20.00 | 240.00 |\n"
                "| Courier | 12 | 39.80 | 477.60 |"
            ),
        )


def test_item_name_substring_does_not_count_as_evidence():
    with pytest.raises(ValueError, match="no supporting source"):
        ground_extraction(record("Rat"), document("Corporation 12 39.80 477.60"))


def test_ambiguous_numeric_date_not_guessed():
    invoice = record()
    invoice.invoice_date = "2026-05-11"
    ground_extraction(invoice, document("05/11/2026\nCopper bus bar 12 39.80 477.60"))
    assert invoice.invoice_date is None


def test_wrapped_table_rate_is_grounded_in_reconstructed_source():
    invoice = record(
        "Emergency Bunker Surcharge", quantity="2.40", unit_price="14.00", line_total="44.02"
    )
    source = (
        "| DESCRIPTION | GST | CHARGES |\n|---|---|---|\n"
        "| Emergency Bunker Surcharge - 2.40 M3 @ USD | Zero Rated | 44.02 |\n"
        "| 14.00/M3 USD 33.60 @ 1.310000 General Rate Increase - 2.40 M3 @ USD 18.00/M3 | Zero Rated | 56.59 |"
    )
    ground_extraction(invoice, document(source))
