# Orientation and selective handwriting recovery

Implemented locally on 8–9 November 2026. This is an engineering validation, not a
handwriting accuracy benchmark. User documents and diagnostic outputs remain under
ignored `backend/runtime/`; they are not added to Git.

## Changes

1. Classify scanned pages using PP-LCNet_x1_0_doc_ori before Docling. Apply a
   confident quarter-turn to a temporary PDF; preserve the uploaded file, hash,
   and original-coordinate evidence boxes. Below 0.90 confidence, retain the
   existing OCR fallback instead of trusting the classifier.
2. Detect region boxes independently of text recognition. Compare RapidOCR
   transcriptions of original and contrast-enhanced crops. Flag empty, low-confidence,
   inconsistent, or malformed-currency readings. Skip identifiable scanner watermarks
   and boilerplate when selecting expensive retries.
3. Retry selected crops using local PaddleOCR-VL-1.5, with a second image view for
   corroboration. Defaults: four crops, 60 seconds total retry budget, 96 tokens / 30
   seconds per generation, plus the existing hard worker deadline. Disagreements or
   truncated output remain unresolved. Persist observations and review warnings.
4. Remove copied product examples from the extraction prompts. Require source support
   for item descriptions/codes, numbers, and header/checking fields. Reject unsupported
   items after the existing bounded refinement opportunity. Preserve supported printed
   numbers during refinement; do not reward candidates just for making arithmetic work.
   Numeric dates with ambiguous day/month order remain null. Persist line evidence
   with the document for both checked and totals-only projects.

## Local observations

- **Orientation:** the English handwritten scan, rotated into four test orientations,
  received the correct correction in all four cases. Confidence was 0.920–0.925;
  all exceeded the configured 0.90 threshold. The supplied sideways Chinese receipt
  received a 270° clockwise correction at 0.923 confidence. Four orientations were
  used to test the classifier, not as four production OCR passes.
- **Automatic crops:** the English scan's handwritten item and amount were detected
  without manual crop coordinates. Paddle agreed across both views on the item text
  and a currency-like string followed by 278. The currency-like string remains
  ambiguous; no SGD inference is justified.
- **Integration:** the original Docling amount and recovered amount differed. Spatial
  matching now replaces the old span instead of appending a competing value. Both the
  old observations and the new candidate remain in diagnostics.
- **Local extraction:** with the configured `qwen3:4b` / `qwen3:8b` pipeline and updated
  prompts, the last test returned the source-supported item without invented catalog
  products. It left quantity, unit price, total and currency null. This is a partial
  extraction requiring review, **not** a solved end-to-end invoice. The later date guard
  also clears the model's ambiguous numeric-date interpretation.

## Automated checks

Tests cover quarter-turn coordinate round trips, classification before conversion,
unchanged original PDF/hash, unreadable detection boxes, retry-count and time bounds,
fallback disagreements, spatial replacement of old OCR, prompt-product rejection,
price borrowing across table rows, deterministic reconstruction of wrapped source rows,
ambiguous currency/date, printed arithmetic preservation, and API evidence persistence.

The final full backend suite passed 560 tests (32 skipped).
The focused integration suite also passed 123 tests. Lint,
format and dependency-lock consistency were also checked. These tests use fake models
except for the explicitly described local document experiments.

## Limits and deployment

Confidence thresholds have not been calibrated against a representative handwriting
corpus. Matching transcriptions can share the same error. Source grounding prevents
unsupported model output but cannot prove that OCR read the document correctly or
that a source-supported value was assigned the correct business meaning. Uncertain
recoveries carry manual-review warnings.

Recovery runs automatically using cached weights, with a four-crop / 60-second
retry budget defined in code. Production Docker still installs only the `docling`
extra; install `handwriting` and provision weights for automatic recovery there. See `backend/README.md` for setup and settings. No database
migration is required: diagnostics and evidence use the existing document JSON field.

Model interfaces: [orientation classifier](https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori)
and [PaddleOCR-VL-1.5](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5).
