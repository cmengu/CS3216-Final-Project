"""Invented PDF smoke tests; no real business documents or API requests."""

import pytest
from pypdf import PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
)

from invoice_processing.docling_reader import read_pdf

pytestmark = pytest.mark.docling


def test_real_digital_pdf(tmp_path):
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    stream.set_data(
        b"BT /F1 16 Tf 50 780 Td (INVOICE DEMO-001) Tj "
        b"0 -30 Td (Invented Farm Pte Ltd) Tj "
        b"0 -30 Td (Currency: SGD   Total: 27.25) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    path = tmp_path / "invented-digital.pdf"
    writer.write(path)
    document = read_pdf(path)
    assert "DEMO-001" in document.markdown
    assert any(block.locations for block in document.blocks)
    assert (
        document.docling_document["page_documents"][0]["document"]["schema_name"]
        == "DoclingDocument"
    )
    assert document.pages[0].ocr_ran is False
    assert document.pages[0].extraction_method == "embedded_text"


def test_real_scanned_pdf(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1200, 1600), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=42)
    draw.multiline_text(
        (100, 100),
        "INVOICE DEMO-002\n\nInvented Farm\n\nTOTAL SGD 27.25",
        fill="black",
        font=font,
        spacing=20,
    )
    path = tmp_path / "invented-scan.pdf"
    image.save(path, "PDF", resolution=150)
    document = read_pdf(path, force_ocr=True)
    assert "27.25" in document.markdown
    assert any(block.locations for block in document.blocks)
    assert document.pages[0].ocr_ran is True
    assert document.pages[0].ocr_cells > 0


def test_generated_tables_and_mixed_pages(tmp_path):
    from pathlib import Path

    from pypdf import PdfReader

    data = Path(__file__).resolve().parents[2] / "data/dummy"
    writer = PdfWriter()
    writer.add_page(PdfReader(data / "invoice-01.pdf").pages[0])
    writer.add_page(PdfReader(data / "invoice-01-scan.pdf").pages[0])
    path = tmp_path / "mixed.pdf"
    writer.write(path)
    document = read_pdf(path)
    assert [p.ocr_ran for p in document.pages] == [False, True]
    assert [p.extraction_method for p in document.pages] == ["embedded_text", "ocr"]
    assert "RES-0603-10K" in document.pages[0].markdown
    assert "0.0047" in document.pages[0].markdown
    assert any("tables" in block.id for block in document.blocks)
    assert len({block.id for block in document.blocks}) == len(document.blocks)
    assert {loc.page for block in document.blocks for loc in block.locations} == {1, 2}
