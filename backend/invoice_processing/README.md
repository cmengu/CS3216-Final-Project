# Earlier experiment — not the build-plan service

The invoice-register matcher below is retained for reference only. Use `../README.md` for Duc's current service. Chen Meng and Kalent own the replacement extraction/check stages.

# Invoice processing — Person 3

This Python module adds a separate invoice pipeline beside the existing browser-based PO
importer. It does not change the Next.js demo, create a web server, or write to the mastersheet.

```
Local PDF → Docling OCR/layout/tables → OpenAI Structured Outputs
          → evidence validation → decimal comparison → review result
```

## Setup

Python 3.10–3.13 is required (tested locally with 3.12). From `backend/`, with
[uv](https://docs.astral.sh/uv/getting-started/installation/) installed:

```sh
uv sync --locked --extra dev --extra docling
```

`uv.lock` pins the resolved dependencies. The Docling extra includes ML dependencies and
downloads model weights on first conversion. Basic tests and comparison need only
`uv sync --locked --extra dev` and do not load Docling or call OpenAI.

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in your backend environment before extraction.
Choose an available model supporting Responses Structured Outputs. No model is silently
selected, and there is no key in browser code. Environment files are not automatically loaded.
Do not commit credentials or document artifacts.

## Try comparison without an API key

All fixtures are invented. This produces a `matched` result:

```sh
.venv/bin/invoice-process compare tests/fixtures/extraction.json \
  --master tests/fixtures/master.json --out artifacts/demo-comparison.json
```

Edit a copy of the extraction's unit price to see `UNIT_PRICE_MISMATCH`, including its
mastersheet row ID and source evidence. The fixture document is a hand-authored adapter
fixture, not output from a real Docling/model run; its hash is a synthetic fixture identifier.

## Process a PDF

```sh
.venv/bin/invoice-process process /absolute/path/invoice.pdf \
  --master tests/fixtures/master.json --out artifacts/run-1
```

Replace the sample mastersheet JSON with an authorized snapshot of your own reference data.
The command writes:

- `document.json`: PDF SHA-256, Docling version, Markdown, original Docling JSON, and
  source blocks with page coordinates and dimensions.
- `extraction.json`: printed invoice values, evidence references, model/prompt version,
  response ID, and grounding issues.
- `comparison.json`: snapshot ID/hash, rule version, review status, and discrepancies.

You can run each stage separately to inspect or retry it:

```sh
.venv/bin/invoice-process parse /absolute/path/invoice.pdf --out artifacts/document.json
.venv/bin/invoice-process extract artifacts/document.json --out artifacts/extraction.json
.venv/bin/invoice-process compare artifacts/extraction.json \
  --master tests/fixtures/master.json --out artifacts/comparison.json
```

Use `--force-ocr` on `parse` or `process` for a broken text layer or a scanned document.
Input is limited to a local, unencrypted PDF of at most 20 MiB and 30 pages. Partial
conversions fail rather than silently dropping pages. Model input above 200,000 characters
fails rather than truncating later lines. A refusal or incomplete model response is an error.

Document blocks are sent to OpenAI; the mastersheet and original PDF are not. `store=False`
is supplied to the Responses API; this is not a claim of zero provider retention. Docling's
standard conversion runs locally. The first run needs network access to fetch its models.

## Mastersheet contract and v1 rules

The initial contract is an **invoice register**, illustrated in `tests/fixtures/master.json`.
It contains a versioned snapshot and expected invoices, each identified by printed supplier
registration/tax ID plus invoice number. It is not a product price catalogue or a PO ledger.
Person 4 should transform the actual spreadsheet into this contract after the team agrees
its column mapping. If the actual sheet is a PO ledger, add a separate matcher and contract;
do not relabel it as an invoice register.

Amounts and quantities are decimal strings. Comparison joins exact normalized supplier IDs,
invoice numbers, and SKUs (case/whitespace only). It never uses the demo's product prices.
Duplicate invoice keys and repeated SKUs require review instead of selecting the first row.
Line descriptions are retained for review but are not used for fuzzy matching.

Supported arithmetic is `quantity × unit_price − absolute line discount = pre-tax line total`,
`sum(line totals) = subtotal`, and `subtotal + tax = grand total`. Rounding is half-up to two
decimal places for SGD, USD, EUR, GBP, AUD, MYR, and HKD. Prices and quantities compare exactly;
there is no currency/unit conversion or configurable tolerance in v1. The supplied tax amount
is compared, not recomputed from jurisdiction rules. Tax-inclusive prices, credits, freight,
header discounts, and other adjustments require review/additional schema support.

Missing printed values stay null, including discount: an absent discount is not silently
invented as zero. This conservative policy means many real invoices will need review until
the team agrees explicit rules for absent fields. SKU aliases and substitutions are also
left to review in this version.

- `matched`: supported rules pass, required numeric values exist, no extraction warnings or
  grounding issues. This is not approval and does not change an order's state.
- `needs_review`: differences, missing/invalid values, missing evidence, or warnings.
- `unable_to_verify`: no unique reference, invalid reference arithmetic, unsupported document
  type, or unsupported currency.

Grounding checks confirm that quotes occur in referenced source blocks with page provenance.
They do not prove the model chose the correct field or that every printed row was extracted.
Table evidence uses the table's box, not a fabricated cell box. Preserve coordinate origin
and page dimensions when Person 1 implements highlighting. Keep the original PDF in protected
storage under Person 2/4's retention policy; Docling JSON is not a replacement PDF viewer.

## Team integration

Person 2 can call these synchronous functions from a worker:

```python
from pathlib import Path
from invoice_processing.docling_reader import read_pdf
from invoice_processing.extractor import extract_invoice
from invoice_processing import MasterSnapshot, compare_invoice

snapshot = MasterSnapshot.model_validate(snapshot_data)
document = read_pdf(Path(local_file))
extraction = extract_invoice(document, model=configured_model)
comparison = compare_invoice(extraction, snapshot)
```

Suggested job lifecycle: queued → parsing → extracting → comparing → completed/failed.
The comparison status is separate from job status. Add authenticated endpoints, durable jobs,
retry/idempotency logic, tenant-scoped hash deduplication, storage and audit logs in the backend.
The hash provided here enables deduplication but does not perform a database lookup.
Do not run OCR inside the browser or block an async request handler with it.

Person 1 can mock responses from the fixtures now. Render `Issue.field`, invoice/master
values, `master_row_id`, and evidence. Resolve each `block_id` against `document.blocks` for
page coordinates. Persist reviewer corrections separately from the original extraction.
If values are edited, rerun validation/comparison; do not reuse a previous `matched` result.

## Verification

```sh
.venv/bin/pytest -q
.venv/bin/ruff check invoice_processing tests
.venv/bin/ruff format --check invoice_processing tests
# Real digital-PDF and scanned-PDF tests; downloads local model weights, no OpenAI calls:
.venv/bin/pytest -q --run-docling
```

Unit tests mock OpenAI. They cover matching, numeric validation, source grounding, incomplete
responses, ambiguous references, table provenance, input limits, and CLI output. Real Docling
tests create invented PDFs in temporary directories. An actual OpenAI extraction still needs
your configured API key/model; do not mistake mock tests for an extraction-accuracy benchmark.

Before making automatic decisions, benchmark 10–20 representative invented invoices with
expected fields and rows. Track line recall, numeric field accuracy, false matches, latency,
and API cost. Direct vision fallback, a labeled evaluation runner, spreadsheet ingestion,
approved SKU aliases, and production job infrastructure are follow-up work.

Implementation references: [Docling conversion](https://docling-project.github.io/docling/_generated/examples/custom_convert/),
[Docling provenance](https://docling-project.github.io/docling/reference/docling_document/), and
[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
