"""Local PDF conversion. Preserve Docling JSON and stable evidence references."""

import hashlib
from functools import lru_cache
from importlib.metadata import version
from pathlib import Path
from threading import Lock

from pypdf import PdfReader

from .models import Location, PageRead, ParsedDocument, SourceBlock

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 30
_conversion_lock = Lock()


def validate_pdf(path: Path) -> tuple[str, int]:
    if not path.is_file() or path.suffix.lower() != ".pdf":
        raise ValueError("Input must be a local PDF file")
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("PDF must be nonempty and at most 20 MiB")
    data = path.read_bytes()
    if not data.startswith(b"%PDF-"):
        raise ValueError("File does not have a PDF signature")
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported")
        pages = len(reader.pages)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("PDF could not be opened") from exc
    if not 1 <= pages <= MAX_PAGES:
        raise ValueError("PDF must contain 1–30 pages")
    return hashlib.sha256(data).hexdigest(), pages


def document_blocks(document) -> list[SourceBlock]:
    blocks = []
    for item, _depth in document.iterate_items():
        # Tables retain their structure in the model input. Their provenance is table-level,
        # not a promise of precise per-cell bounding boxes.
        if getattr(item, "label", None) == "table":
            text = item.export_to_markdown(doc=document)
        else:
            text = getattr(item, "text", "")
        if not text.strip():
            continue
        locations = []
        for prov in getattr(item, "prov", []):
            page = document.pages.get(prov.page_no)
            size = getattr(page, "size", None)
            locations.append(
                Location(
                    page=prov.page_no,
                    bbox=prov.bbox.model_dump(mode="json"),
                    page_width=size.width if size else None,
                    page_height=size.height if size else None,
                )
            )
        blocks.append(SourceBlock(id=item.self_ref, text=text, locations=locations))
    return blocks


@lru_cache(maxsize=2)
def _converter(ocr: bool):
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions()
    options.do_ocr = ocr
    options.do_table_structure = True
    options.generate_parsed_pages = True  # Retain from_ocr flags until metadata is recorded.
    options.ocr_options = RapidOcrOptions(mode=OcrMode.FULL_PAGE)
    options.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=4)
    options.table_structure_options.do_cell_matching = True
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )


def read_pdf(path: Path, *, force_ocr: bool = False) -> ParsedDocument:
    document_hash, page_count = validate_pdf(path)
    from docling.datamodel.base_models import ConversionStatus
    from docling.exceptions import ConversionError

    source = PdfReader(path)
    blocks, pages, documents = [], [], []
    # CPU models are cached and used serially. Each textless page takes the full-page OCR
    # branch, so ocr_ran describes an executed stage, not merely enabled configuration.
    with _conversion_lock:
        for index, page in enumerate(source.pages, start=1):
            text = page.extract_text() or ""
            use_ocr = force_ocr or not text.strip()
            try:
                result = _converter(use_ocr).convert(
                    path,
                    page_range=(index, index),
                    max_num_pages=MAX_PAGES,
                    max_file_size=MAX_BYTES,
                )
            except ConversionError as exc:
                raise ValueError(f"Docling could not read page {index}") from exc
            if result.status != ConversionStatus.SUCCESS:
                raise ValueError(f"Incomplete conversion on page {index}")
            page_blocks = document_blocks(result.document)
            for block in page_blocks:
                block.id = f"page-{index}:{block.id}"
                for location in block.locations:
                    location.page = index
            ocr_cells = sum(1 for p in result.pages for cell in p.cells if cell.from_ocr)
            warnings = []
            if not page_blocks:
                warnings.append("No readable content on this page; human review required")
            if use_ocr and not ocr_cells:
                warnings.append("OCR produced no recognized text")
            markdown = result.document.export_to_markdown()
            pages.append(
                PageRead(
                    page_number=index,
                    extraction_method="ocr" if use_ocr else "embedded_text",
                    ocr_ran=use_ocr,
                    embedded_characters=len(text.strip()),
                    ocr_cells=ocr_cells,
                    markdown=markdown,
                    block_ids=[b.id for b in page_blocks],
                    warnings=warnings,
                )
            )
            blocks.extend(page_blocks)
            documents.append({"page_number": index, "document": result.document.export_to_dict()})
    if not blocks:
        raise ValueError("No readable text or tables; retry with --force-ocr or review manually")
    return ParsedDocument(
        document_hash=document_hash,
        filename=path.name,
        page_count=page_count,
        reader_version=f"docling/{version('docling')}",
        markdown="\n\n".join(f"<!-- Page {p.page_number} -->\n{p.markdown}" for p in pages),
        blocks=blocks,
        pages=pages,
        docling_document={"page_documents": documents},
    )
