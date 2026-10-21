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


@lru_cache(maxsize=1)
def _rapid_ocr():
    from rapidocr import RapidOCR

    return RapidOCR()


def _is_sideways_page(blocks: list[SourceBlock]) -> bool:
    text_boxes = [
        loc.bbox
        for block in blocks
        if "tables" not in block.id and len(block.text.strip()) >= 3
        for loc in block.locations
        if isinstance(loc.bbox, dict) and all(k in loc.bbox for k in ("l", "t", "r", "b"))
    ]
    if len(text_boxes) < 4:
        return False
    vertical = sum(
        1
        for bbox in text_boxes
        if abs(float(bbox["t"]) - float(bbox["b"])) > abs(float(bbox["r"]) - float(bbox["l"])) * 2.0
    )
    return vertical > len(text_boxes) / 2


def _encode_page_image(pil_image) -> str:
    import base64
    import io

    image = pil_image.convert("RGB")
    image.thumbnail((1400, 1400))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _render_page_pil(path: Path, page_number: int, *, scale: float = 2.0):
    import pypdfium2 as pdfium

    pdf_doc = pdfium.PdfDocument(str(path))
    try:
        return pdf_doc[page_number - 1].render(scale=scale).to_pil()
    finally:
        pdf_doc.close()


def _recover_sideways_page(
    path: Path, page_number: int
) -> tuple[str, list[SourceBlock], int, str, int] | None:
    import numpy as np
    from PIL import Image

    pil_image = _render_page_pil(path, page_number, scale=2.0)
    engine = _rapid_ocr()
    keywords = ("INVOICE", "TOTAL", "AMOUNT", "DATE", "QUANTITY", "PRICE", "DESCRIPTION", "CODE")

    best_out = None
    best_image = None
    best_rotation = 0
    best_score = -1
    for transpose_op in (Image.Transpose.ROTATE_270, Image.Transpose.ROTATE_90):
        rotated = pil_image.transpose(transpose_op)
        out = engine(np.array(rotated))
        txts = getattr(out, "txts", None)
        boxes = getattr(out, "boxes", None)
        if txts is None or boxes is None or len(txts) == 0 or len(boxes) == 0:
            continue
        upper_blob = " ".join(txts).upper()
        kw_hits = sum(1 for kw in keywords if kw in upper_blob)
        score = kw_hits * 1000 + len(txts)
        if score > best_score:
            best_score = score
            best_out = out
            best_image = rotated
            best_rotation = 90 if transpose_op == Image.Transpose.ROTATE_270 else 270
        if kw_hits >= 4:
            break

    if best_out is None or best_image is None:
        return None

    width, height = best_image.size
    items = []
    for box, text in zip(best_out.boxes, best_out.txts):
        cleaned = (text or "").strip()
        if not cleaned:
            continue
        xs = [float(pt[0]) for pt in box]
        ys = [float(pt[1]) for pt in box]
        items.append(
            {
                "text": cleaned,
                "x_min": min(xs),
                "x_max": max(xs),
                "y_min": min(ys),
                "y_max": max(ys),
                "y_center": sum(ys) / len(ys),
            }
        )
    if not items:
        return None

    items.sort(key=lambda item: item["y_center"])
    rows: list[list[dict]] = []
    for item in items:
        if not rows or abs(item["y_center"] - rows[-1][0]["y_center"]) > 18.0:
            rows.append([item])
        else:
            rows[-1].append(item)

    lines_md: list[str] = []
    blocks: list[SourceBlock] = []
    for row_idx, row in enumerate(rows, start=1):
        row.sort(key=lambda item: item["x_min"])
        line_text = " | ".join(item["text"] for item in row)
        lines_md.append(line_text)
        blocks.append(
            SourceBlock(
                id=f"page-{page_number}:#/upright/{row_idx}",
                text=line_text,
                locations=[
                    Location(
                        page=page_number,
                        bbox={
                            "l": min(item["x_min"] for item in row),
                            "t": min(item["y_min"] for item in row),
                            "r": max(item["x_max"] for item in row),
                            "b": max(item["y_max"] for item in row),
                            "coord_origin": "TOPLEFT",
                        },
                        page_width=float(width),
                        page_height=float(height),
                    )
                ],
            )
        )
    # Convert upright OCR pixels back to original PDF coordinates for viewer highlights.
    page = PdfReader(path).pages[page_number - 1]
    W, H = float(page.mediabox.width), float(page.mediabox.height)
    rotation = (int(page.rotation) + best_rotation) % 360
    for block in blocks:
        loc = block.locations[0]
        box = loc.bbox
        points = []
        for x, y in ((box["l"], box["t"]), (box["r"], box["b"])):
            u, v = x / width, y / height
            if rotation == 90:
                points.append((v * W, u * H))
            elif rotation == 270:
                points.append(((1 - v) * W, (1 - u) * H))
            elif rotation == 180:
                points.append(((1 - u) * W, v * H))
            else:
                points.append((u * W, (1 - v) * H))
        loc.bbox = {"l": min(p[0] for p in points), "r": max(p[0] for p in points),
                    "b": min(p[1] for p in points), "t": max(p[1] for p in points),
                    "coord_origin": "BOTTOMLEFT"}
        loc.page_width, loc.page_height = W, H
    return "\n".join(lines_md), blocks, len(items), _encode_page_image(best_image), best_rotation


def read_pdf(path: Path, *, force_ocr: bool = False) -> ParsedDocument:
    document_hash, page_count = validate_pdf(path)
    from docling.datamodel.base_models import ConversionStatus
    from docling.exceptions import ConversionError

    source = PdfReader(path)
    blocks, pages, documents = [], [], []
    page_images: dict[str, str] = {}
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
            markdown = result.document.export_to_markdown()
            display_rotation = 0
            if use_ocr and _is_sideways_page(page_blocks):
                recovered = _recover_sideways_page(path, index)
                if recovered is not None:
                    upright_md, upright_blocks, upright_cells, image_data_url, display_rotation = recovered
                    markdown = upright_md
                    page_blocks = upright_blocks
                    ocr_cells = max(ocr_cells, upright_cells)
                    page_images[str(index)] = image_data_url
            elif use_ocr:
                try:
                    page_images[str(index)] = _encode_page_image(
                        _render_page_pil(path, index, scale=1.5)
                    )
                except Exception:
                    pass
            warnings = []
            if not page_blocks:
                warnings.append("No readable content on this page; human review required")
            if use_ocr and not ocr_cells:
                warnings.append("OCR produced no recognized text")
            pages.append(
                PageRead(
                    page_number=index,
                    display_rotation=display_rotation,
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
    docling_payload: dict = {"page_documents": documents}
    if page_images:
        docling_payload["page_images"] = page_images
    return ParsedDocument(
        document_hash=document_hash,
        filename=path.name,
        page_count=page_count,
        reader_version=f"docling/{version('docling')}",
        markdown="\n\n".join(f"<!-- Page {p.page_number} -->\n{p.markdown}" for p in pages),
        blocks=blocks,
        pages=pages,
        docling_document=docling_payload,
    )

