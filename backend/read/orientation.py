"""Image-only document orientation, before OCR; coordinate transforms stay explicit."""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Orientation:
    clockwise: int = 0
    confidence: float = 0.0
    accepted: bool = False
    reason: str = "classifier_unavailable"


@lru_cache(maxsize=1)
def _classifier():
    from paddleocr import DocImgOrientationClassification

    return DocImgOrientationClassification(device="cpu", enable_mkldnn=False)


def detect_orientation(image) -> Orientation:
    import numpy as np

    threshold = float(os.environ.get("INVOICE_ORIENTATION_MIN_CONFIDENCE", "0.90"))
    if not 0 <= threshold <= 1:
        raise ValueError("Orientation confidence threshold must be between zero and one")
    try:
        result = next(iter(_classifier().predict(np.asarray(image.convert("RGB"))[:, :, ::-1])))
        angle = int(result["label_names"][0])
        confidence = float(result["scores"][0])
        if angle not in (0, 90, 180, 270):
            return Orientation(reason="invalid_angle")
        # Paddle labels indicate the counter-clockwise correction, PDF /Rotate is clockwise.
        return Orientation(
            (-angle) % 360,
            confidence,
            confidence >= threshold,
            "classified" if confidence >= threshold else "low_confidence",
        )
    except (ImportError, ModuleNotFoundError):
        return Orientation()
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "Orientation classifier failed (%s); using OCR fallback", type(exc).__name__
        )
        return Orientation(reason="classifier_failed")


def to_original_bbox(box, width, height, pdf_width, pdf_height, rotation):
    """Display-space TOPLEFT bbox -> unrotated PDF BOTTOMLEFT bbox (quarter turns)."""
    points = []
    for x, y in ((box["l"], box["t"]), (box["r"], box["b"])):
        u, v = x / width, y / height
        if rotation % 360 == 90:
            point = (v * pdf_width, u * pdf_height)
        elif rotation % 360 == 180:
            point = ((1 - u) * pdf_width, v * pdf_height)
        elif rotation % 360 == 270:
            point = ((1 - v) * pdf_width, (1 - u) * pdf_height)
        else:
            point = (u * pdf_width, (1 - v) * pdf_height)
        points.append(point)
    return dict(
        l=min(p[0] for p in points),
        r=max(p[0] for p in points),
        b=min(p[1] for p in points),
        t=max(p[1] for p in points),
        coord_origin="BOTTOMLEFT",
    )
