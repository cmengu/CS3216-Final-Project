from types import SimpleNamespace

import pytest

from read.orientation import detect_orientation, to_original_bbox
from read.regions import retry_reasons


def test_high_confidence_garbage_is_still_flagged():
    assert "malformed_currency_amount" in retry_reasons("S60278", 0.94, "S60278")
    assert "preprocessing_disagreement" in retry_reasons("278", 0.99, "218")
    assert "detected_but_unreadable" in retry_reasons("", 0, "")
    assert retry_reasons("SGD 278", 0.99, "SGD 278") == []


@pytest.mark.parametrize("angle,expected", [(0, 0), (90, 270), (180, 180), (270, 90)])
def test_classifier_direction_and_low_confidence(monkeypatch, angle, expected):
    np = pytest.importorskip("numpy")
    from PIL import Image

    from read import orientation

    monkeypatch.setattr(
        orientation,
        "_classifier",
        lambda: SimpleNamespace(
            predict=lambda _: iter([{"label_names": [str(angle)], "scores": [0.95]}])
        ),
    )
    result = detect_orientation(Image.fromarray(np.zeros((10, 10, 3), dtype="uint8")))
    assert result.accepted and result.clockwise == expected
    monkeypatch.setenv("INVOICE_ORIENTATION_MIN_CONFIDENCE", ".99")
    assert not detect_orientation(Image.new("RGB", (10, 10))).accepted


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_rotated_crop_bbox_round_trip(rotation):
    W, H = 600, 800
    # PDF point rectangle (60,160)-(180,320), project into clockwise display.
    points = []
    width, height = (H, W) if rotation in (90, 270) else (W, H)
    for x, y in ((60, 160), (180, 320)):
        u, v = x / W, y / H
        point = {0: (u, 1 - v), 90: (v, u), 180: (1 - u, v), 270: (1 - v, 1 - u)}[rotation]
        points.append((point[0] * width, point[1] * height))
    box = dict(
        l=min(p[0] for p in points),
        r=max(p[0] for p in points),
        t=min(p[1] for p in points),
        b=max(p[1] for p in points),
    )
    result = to_original_bbox(box, width, height, W, H, rotation)
    assert [result[k] for k in ("l", "b", "r", "t")] == pytest.approx([60, 160, 180, 320])


def test_detection_only_regions_include_unreadable_and_cap_fallback(monkeypatch):
    np = pytest.importorskip("numpy")
    from PIL import Image

    from read.regions import recover_regions

    boxes = np.array([[[10, y], [100, y], [100, y + 15], [10, y + 15]] for y in (10, 40, 70)])

    def engine(_image, **kwargs):
        if not kwargs["use_rec"]:
            return SimpleNamespace(boxes=boxes)
        return SimpleNamespace(txts=[], scores=[])

    monkeypatch.setattr("read.regions.MAX_RECOVERY_CROPS", 1)
    calls = []

    def fallback(image):
        calls.append(image.size)
        return "Handwritten item"

    regions, warnings, diagnostic = recover_regions(
        Image.new("RGB", (150, 100)), engine, fallback=fallback
    )
    assert len(calls) == 2  # original and enhanced for ONE crop, not the whole page
    assert regions[0].accepted
    assert not regions[1].accepted
    assert "retry_budget_exhausted" in regions[1].reasons
    assert warnings and diagnostic[0]["bbox"] == regions[0].bbox


def test_disagreeing_fallback_not_accepted(monkeypatch):
    pytest.importorskip("numpy")
    from PIL import Image

    from read import regions

    monkeypatch.setattr(regions, "automatic_regions", lambda *_: [regions.Region((0, 0, 30, 20))])
    monkeypatch.setattr(regions, "recognize_crop", lambda *_: ("", 0))
    candidates = iter(["278", "218"])
    result, warnings, _ = regions.recover_regions(
        Image.new("RGB", (30, 20)), None, fallback=lambda _: next(candidates)
    )
    assert not result[0].accepted
    assert warnings


def test_orientation_precedes_conversion_and_preserves_original_identity(tmp_path, monkeypatch):
    import hashlib

    from pypdf import PdfWriter

    from read import orientation, reader
    from read.models import Location, PageRead, ParsedDocument, SourceBlock

    path = tmp_path / "source.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.write(path)
    order = []
    monkeypatch.setattr(reader, "_render_page_pil", lambda *_, **__: object())

    def detect(_):
        order.append("classify")
        return orientation.Orientation(90, 0.99, True, "classified")

    monkeypatch.setattr(orientation, "detect_orientation", detect)

    def convert(rotated, **_):
        order.append("ocr")
        assert reader.PdfReader(rotated).pages[0].rotation == 90
        return ParsedDocument(
            document_hash="temporary",
            filename="upright.pdf",
            page_count=1,
            reader_version="test",
            markdown="Item",
            docling_document={},
            blocks=[
                SourceBlock(
                    id="page-1:#/texts/1",
                    text="Item",
                    locations=[
                        Location(
                            page=1,
                            bbox=dict(l=160, r=320, t=540, b=420, coord_origin="BOTTOMLEFT"),
                            page_width=800,
                            page_height=600,
                        )
                    ],
                )
            ],
            pages=[
                PageRead(
                    page_number=1,
                    extraction_method="ocr",
                    ocr_ran=True,
                    embedded_characters=0,
                    ocr_cells=1,
                    markdown="Item",
                    block_ids=[],
                )
            ],
        )

    monkeypatch.setattr(reader, "_read_pdf", convert)
    result = reader.read_pdf(path)
    assert order == ["classify", "ocr"]
    assert result.filename == "source.pdf"
    assert result.document_hash == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result.pages[0].display_rotation == 90
    box = result.blocks[0].locations[0].bbox
    assert [box[k] for k in ("l", "b", "r", "t")] == pytest.approx([60, 160, 180, 320])
    assert reader.PdfReader(path).pages[0].rotation == 0


def test_retry_timeout_preserves_diagnostics_for_review(monkeypatch):
    pytest.importorskip("numpy")
    from PIL import Image

    from read import regions
    from read.budget import ProcessingTimeout

    monkeypatch.setattr(regions, "automatic_regions", lambda *_: [regions.Region((0, 0, 30, 20))])
    monkeypatch.setattr(regions, "recognize_crop", lambda *_: ("", 0))

    def timeout(_):
        raise ProcessingTimeout("budget expired")

    result, warnings, diagnostics = regions.recover_regions(
        Image.new("RGB", (30, 20)), None, fallback=timeout
    )
    assert not result[0].accepted
    assert "retry_time_budget_exhausted" in diagnostics[0]["reasons"]
    assert warnings


def test_recovered_crop_replaces_spatially_matching_old_text(tmp_path, monkeypatch):
    Image = pytest.importorskip("PIL.Image")
    from pypdf import PdfWriter

    from read import reader, region_integration
    from read.models import Location, SourceBlock
    from read.regions import Region

    path = tmp_path / "scan.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.write(path)
    blocks = [
        SourceBlock(
            id="page-1:#/texts/1",
            text="S6D278",
            locations=[
                Location(
                    page=1,
                    bbox=dict(l=105, r=195, t=695, b=675, coord_origin="BOTTOMLEFT"),
                    page_width=600,
                    page_height=800,
                )
            ],
        )
    ]
    region = Region((100, 100, 200, 130), original="S60278", candidate="S&D 278", accepted=True)
    monkeypatch.setattr(reader, "_render_page_pil", lambda *_, **__: Image.new("RGB", (600, 800)))
    monkeypatch.setattr(reader, "_rapid_ocr", lambda: None)
    monkeypatch.setattr(
        region_integration,
        "recover_regions",
        lambda *_: ([region], ["Review"], [{"accepted": True, "reasons": []}]),
    )
    md, result, warnings, _ = region_integration.apply_region_recovery(
        path, 1, 0, "Invoice\nTotalAmount\nS6D278", blocks
    )
    assert "S6D278" not in md
    assert md.count("S&D 278") == 1
    assert len(result) == 1 and "#/crop/" in result[0].id
    assert result[0].locations[0].bbox["t"] == 700
    assert warnings == ["Review"]


def test_missing_optional_model_keeps_ocr_for_review_and_stops_retries(monkeypatch):
    pytest.importorskip("numpy")
    from PIL import Image

    from read import regions

    monkeypatch.setattr(
        regions,
        "automatic_regions",
        lambda *_: [regions.Region((0, 0, 30, 20)), regions.Region((0, 20, 30, 40))],
    )
    monkeypatch.setattr(regions, "recognize_crop", lambda *_: ("", 0))
    calls = []

    def unavailable(_):
        calls.append(True)
        raise OSError("Optional model weights are not provisioned")

    result, warnings, diagnostics = regions.recover_regions(
        Image.new("RGB", (30, 40)), None, fallback=unavailable
    )
    assert len(calls) == 1
    assert not any(r.accepted for r in result)
    assert all("fallback_unavailable" in r["reasons"] for r in diagnostics)
    assert warnings
