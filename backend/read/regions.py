"""Bounded, automatic OCR region retries. Keep all observations for diagnosis."""

import os
import re
import time
from dataclasses import asdict, dataclass, field
from functools import lru_cache

from .budget import ProcessingTimeout, check_budget, invoice_budget, remaining_timeout

# Application defaults, shared by local development and deployed workers.
MAX_RECOVERY_CROPS = 4
RECOVERY_BUDGET_SECONDS = 60


def normalized(text):
    return "".join(c for c in text.casefold() if c.isalnum())


@dataclass
class Region:
    bbox: tuple[int, int, int, int]
    original: str = ""
    enhanced: str = ""
    confidence: float = 0.0
    reasons: list[str] = field(default_factory=list)
    candidate: str = ""
    confirmation: str = ""
    accepted: bool = False


def retry_reasons(text, score, enhanced):
    reasons = []
    if not normalized(text):
        reasons.append("detected_but_unreadable")
    elif score < 0.85:
        reasons.append("low_recognition_confidence")
    if "\ufffd" in text:
        reasons.append("invalid_characters")
    if normalized(text) != normalized(enhanced):
        reasons.append("preprocessing_disagreement")
    if re.search(r"\bS(?:6D?|&D?|G(?!D))\s*0?\d{2,}\b", text, re.I):
        reasons.append("malformed_currency_amount")
    return reasons


def automatic_regions(image, engine):
    """Detection-only boxes survive even when the recognizer returns no text."""
    import numpy as np

    result = engine(np.asarray(image), use_det=True, use_cls=False, use_rec=False)
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []
    width, height = image.size
    regions = []
    for box in boxes:
        xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
        pad = max(4, int((max(ys) - min(ys)) * 0.25))
        rect = (
            max(0, int(min(xs)) - pad),
            max(0, int(min(ys)) - pad),
            min(width, int(max(xs)) + pad),
            min(height, int(max(ys)) + pad),
        )
        if rect[2] - rect[0] >= 8 and rect[3] - rect[1] >= 8:
            regions.append(Region(rect))
    return sorted(regions, key=lambda r: (r.bbox[1], r.bbox[0]))


def recognize_crop(engine, image):
    import numpy as np

    # RapidOCR mutates call flags, so always specify them (including after detection-only).
    result = engine(np.asarray(image), use_det=True, use_cls=True, use_rec=True)
    texts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    return (
        " ".join(texts) if texts is not None else "",
        min(float(s) for s in scores) if scores is not None and len(scores) else 0.0,
    )


@lru_cache(maxsize=1)
def _paddle_vl():
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    # Provision weights separately; request processing must never download gigabytes.
    model_path = os.environ.get("INVOICE_PADDLE_MODEL", "PaddlePaddle/PaddleOCR-VL-1.5")
    model = AutoModelForImageTextToText.from_pretrained(
        model_path, dtype=torch.float32, local_files_only=True
    ).eval()
    processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
    return model, processor


def paddle_recognize(image):
    import torch

    check_budget()
    model, processor = _paddle_vl()
    image = image.copy().convert("RGB")
    image.thumbnail((1024, 512))
    messages = [
        {
            "role": "user",
            "content": [{"type": "image", "image": image}, {"type": "text", "text": "OCR:"}],
        }
    ]
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt"
    )
    with torch.inference_mode():
        output = model.generate(
            **inputs, max_new_tokens=96, do_sample=False, max_time=remaining_timeout(30)
        )
    check_budget()
    generated = output[0][inputs["input_ids"].shape[-1] :]
    eos = model.generation_config.eos_token_id
    eos_ids = eos if isinstance(eos, list) else [eos]
    if not len(generated) or int(generated[-1]) not in eos_ids:
        return ""  # truncated output cannot corroborate a crop
    return processor.decode(generated, skip_special_tokens=True).strip()


def recover_regions(image, engine, *, fallback=paddle_recognize):
    from PIL import ImageOps

    regions = automatic_regions(image, engine)
    warnings = []
    limit = MAX_RECOVERY_CROPS
    attempts = 0
    # Hard cap detection work too; pathological scans cannot create unbounded model calls.
    for region in regions[:120]:
        check_budget()
        crop = image.crop(region.bbox).convert("RGB")
        enhanced = ImageOps.autocontrast(ImageOps.grayscale(crop)).convert("RGB")
        region.original, region.confidence = recognize_crop(engine, crop)
        region.enhanced, _ = recognize_crop(engine, enhanced)
        region.reasons = retry_reasons(region.original, region.confidence, region.enhanced)
        if re.search(
            r"camscanner|scanned with|terms and conditions|warranty does not cover|https?://",
            region.original + " " + region.enhanced,
            re.I,
        ):
            region.reasons = []  # retain observations, but do not spend VLM budget on boilerplate
    flagged = sorted(
        (r for r in regions if r.reasons),
        key=lambda r: (
            0
            if "malformed_currency_amount" in r.reasons
            else 1
            if "detected_but_unreadable" in r.reasons
            else 2
            if r.confidence < 0.85
            else 3,
            r.bbox[1],
        ),
    )
    retry_deadline = time.monotonic() + RECOVERY_BUDGET_SECONDS
    fallback_available = True
    for region in flagged:
        if not fallback_available:
            region.reasons.append("fallback_unavailable")
            continue
        if attempts >= limit or time.monotonic() >= retry_deadline:
            region.reasons.append("retry_budget_exhausted")
            continue
        check_budget()
        crop = image.crop(region.bbox).convert("RGB")
        enhanced = ImageOps.autocontrast(ImageOps.grayscale(crop)).convert("RGB")
        attempts += 1
        try:
            with invoice_budget(seconds=max(0.01, retry_deadline - time.monotonic())):
                candidate = fallback(crop)
                region.candidate = candidate
                # Two views of the same crop; this is corroboration, not independent truth.
                confirmed = fallback(enhanced)
                region.confirmation = confirmed
                check_budget()
        except (ImportError, OSError):
            fallback_available = False
            region.reasons.append("fallback_unavailable")
            continue
        except ProcessingTimeout:
            region.reasons.append("retry_time_budget_exhausted")
            continue
        usable = bool(normalized(candidate)) and not re.search(r"\\|[{}<>]", candidate)
        region.accepted = usable and normalized(candidate) == normalized(confirmed)
        if not region.accepted:
            region.reasons.append("fallback_disagreement")
    unresolved = sum(bool(r.reasons) and not r.accepted for r in regions)
    if unresolved:
        warnings.append(f"{unresolved} OCR regions remain uncertain; human review required")
    if len(regions) > 120:
        warnings.append("OCR region limit reached; human review required")
    if any(r.accepted for r in regions):
        warnings.append("Handwriting OCR recovery used; verify recovered text against the source")
    # Agreement is supporting evidence, not an accuracy guarantee.
    return (
        regions,
        warnings,
        [
            {
                **asdict(r),
                "image_width": image.width,
                "image_height": image.height,
                "coord_origin": "TOPLEFT_PIXEL",
            }
            for r in regions
        ],
    )
