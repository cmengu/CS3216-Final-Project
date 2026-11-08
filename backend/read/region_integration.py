"""Attach crop observations to the reader, replacing spatially corroborated text only."""

from pypdf import PdfReader

from .models import Location, SourceBlock
from .orientation import to_original_bbox
from .regions import normalized, recover_regions


def _covered(block, crop_box, page):
    """Only replace text inside the crop, never a whole table or adjacent item."""
    if "tables" in block.id:
        return False
    for loc in block.locations:
        if not loc.bbox or not loc.page_width or not loc.page_height:
            continue
        box = dict(loc.bbox)
        if "#/upright/" not in block.id and "#/crop/" not in block.id:
            if str(box.get("coord_origin", "")).upper() == "BOTTOMLEFT":
                box["t"], box["b"] = loc.page_height - box["t"], loc.page_height - box["b"]
            box = to_original_bbox(
                box,
                loc.page_width,
                loc.page_height,
                float(page.mediabox.width),
                float(page.mediabox.height),
                int(page.rotation),
            )
        area = (box["r"] - box["l"]) * (box["t"] - box["b"])
        crop_area = (crop_box["r"] - crop_box["l"]) * (crop_box["t"] - crop_box["b"])
        overlap = max(0, min(box["r"], crop_box["r"]) - max(box["l"], crop_box["l"])) * max(
            0, min(box["t"], crop_box["t"]) - max(box["b"], crop_box["b"])
        )
        if area > 0 and overlap / area >= 0.6 and area <= crop_area * 2:
            return True
    return False


def apply_region_recovery(path, page_number, display_rotation, markdown, blocks):
    from .reader import _rapid_ocr, _render_page_pil

    image = _render_page_pil(path, page_number, scale=1.5).rotate(-display_rotation, expand=True)
    regions, warnings, diagnostics = recover_regions(image, _rapid_ocr())
    page = PdfReader(path).pages[page_number - 1]
    for observation in diagnostics:
        observation["pdf_rotation"] = (int(page.rotation) + display_rotation) % 360
    width, height = image.size
    W, H = float(page.mediabox.width), float(page.mediabox.height)
    additions = []
    retained = list(blocks)
    for index, region in enumerate(regions):
        if not region.accepted:
            continue
        left, top, right, bottom = region.bbox
        bbox = to_original_bbox(
            dict(l=left, t=top, r=right, b=bottom),
            width,
            height,
            W,
            H,
            int(page.rotation) + display_rotation,
        )
        covered = [b for b in retained if _covered(b, bbox, page)]
        # Different OCR engines can spell the same crop differently. Spatial provenance
        # resolves which old text to replace; do not leave two competing amounts in input.
        if any(b.text not in markdown for b in covered):
            warnings.append("Recovered crop conflicts with structured text; human review required")
            diagnostics[index]["accepted"] = False
            diagnostics[index]["reasons"].append("structured_source_conflict")
            continue
        for block in covered:
            markdown = markdown.replace(block.text, "", 1)
            retained.remove(block)
        if not covered and normalized(region.candidate) in normalized(markdown):
            continue
        additions.append(
            SourceBlock(
                id=f"page-{page_number}:#/crop/{index}",
                text=region.candidate,
                locations=[Location(page=page_number, bbox=bbox, page_width=W, page_height=H)],
            )
        )
    if additions:
        markdown += "\n\n### Recovered crop text\n" + "\n".join(b.text for b in additions)
    return markdown, retained + additions, warnings, diagnostics
