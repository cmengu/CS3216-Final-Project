# Invoice Checker — Duc's backend

Built for the 10 October build plan: upload → Docling → extraction adapter → checking adapter
→ SQLite. Completed records and original PDFs survive a restart. The existing Next.js PO demo
is unchanged; Nam can build the new screens against this API.

**Modes:** `live` reads PDFs with Docling and extracts printed fields using OpenAI.
The default `INVOICE_CHECKER=standard` keeps the existing `check/` price-sheet workflow.
Set `INVOICE_CHECKER=csv_context` for the extended PO/unit/discount-aware CSV adapter. `fixture` replays answers for the exact original
dummy PDFs and refuses other hashes. Never use fixture mode to measure AI accuracy.

## Live setup and local environment template

Create `backend/.env` using this template. `.env*` is ignored by Git, including this file.
Keep credentials in this backend file, never in `NEXT_PUBLIC_*` or frontend code.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=none
INVOICE_MODE=live
INVOICE_CHECKER=csv_context
INVOICE_PRICE_SHEET=../data/mock_invoice_dataset/master_prices.csv
INVOICE_DATA_DIR=runtime/live
INVOICE_OCR_TIMEOUT=180
```

Fill the key locally. `gpt-6-luna` with reasoning `none` prioritizes latency; availability
depends on the API project. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).
Remove `OPENAI_REASONING_EFFORT` when selecting a model without reasoning support.
Paths above are relative to `backend/`. From that directory:

```sh
uv sync --locked --extra dev --extra docling --extra dummy
.venv/bin/python -m uvicorn api.app:app --env-file .env --host 127.0.0.1 --port 8000 --workers 1
```

Live startup fails clearly if the key, model or price-sheet path is missing. Restart after
editing `.env`. The service validates configuration, but provider access/quota errors can
still occur on the first extraction. Each upload makes one model request with `store=False`.

The price CSV columns are `key`, `supplier`, `po`, `item`, `description`, `uom`, `currency`,
`unit_price`, `discount`, `tax`, `valid_from`, `valid_to`. Rates are fractions, e.g. `0.05`.
Matching requires supplier, PO, invoice date, currency, item and unit. Code-free charges
require an exact description match (ignoring case/whitespace). Codes ignore whitespace from
OCR wrapping; differing characters are never guessed from descriptions. Printed discount
amounts or rates and explicitly printed exchange rates are handled with Decimal
arithmetic. Price differences greater than `0.005` are flagged, including undercharges.
Uncertain/missing context and arithmetic discrepancies require review; an incomplete or
uncertain check has `overcharge_total=null`. This conservative checker does not fuzzy-match
OCR-damaged descriptions or supply master item codes absent from the document.

Live records retain the original invoice fields and add printed PO, tax rate, line units,
line currencies, exchange rates, discounts and extraction warnings. Old fixture records
remain readable. OCR runs in a subprocess with a configurable timeout, including native
imports, so a stalled OpenCV import cannot occupy the processing slot indefinitely.

Run the mock dataset through real OCR and live extraction/checking:

```sh
.venv/bin/python -m api.evaluate ../data/mock_invoice_dataset
# Optional: reuse previously produced reader JSON, with PDF SHA-256 verification.
.venv/bin/python -m api.evaluate ../data/mock_invoice_dataset --ocr-cache runtime/mock-dataset-test
```

Outputs go to ignored `runtime/mock-dataset-eval/`. The evaluator sends only PDF-derived
text to extraction and uses only `master_prices.csv` for checking. It reads `answer_key`
after inference, to score the saved predictions. Reports distinguish completion from
accuracy. Comparisons are positional and give no credit when line counts differ. Provider
access/quota failures stop the batch without repeatedly making doomed requests.

## Run the local service

Python 3.12 is recommended. From `backend/`:

```sh
uv sync --locked --extra dev --extra docling --extra dummy
INVOICE_MODE=fixture .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000 --workers 1
```

For the real steps, with the key and model in the environment:

```sh
INVOICE_MODE=live INVOICE_PRICE_SHEET=../data/dummy/price-sheet.xlsx \
  .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000 --workers 1
```

The price sheet is read once at start; a missing column stops the service and names it. A
changed sheet needs a restart.

Open <http://127.0.0.1:8000/docs> to upload a PDF through Swagger, or from the repository root:

```sh
curl -F 'file=@data/dummy/invoice-02.pdf' http://127.0.0.1:8000/invoices
curl http://127.0.0.1:8000/invoices
```

The first Docling run downloads model weights. Subsequent runs reuse locally cached weights
and converter instances. The reader is configured for CPU execution. No API key is needed for
fixture mode. With no `INVOICE_MODE`, uploads return 503. Any other value stops the start.

This is a local demo service without sign-in. Keep the loopback binding and a single worker.
Only one invoice processes at a time; concurrent uploads receive 429 and Retry-After. The
POST request waits for processing to finish. Configure a generous frontend timeout for the
first model load. Batch queues, authentication and connectors remain future work.

## HTTP contract for Nam

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | Active mode and whether processing is configured |
| POST | `/invoices` | Multipart `file`; 201 with saved record, fields and per-line results |
| GET | `/invoices?limit=50&offset=0` | Newest-first summaries; limit 1–100 |
| GET | `/invoices/{id}` | Saved full record including read output, fields and results |
| GET | `/invoices/{id}/file` | Original PDF for inline viewing |

`POST /invoices?force_ocr=true` explicitly overrides embedded-text selection. A processing
failure returns 422 with the saved failed record; malformed inputs return an HTTP error and
are not retained. Use the returned `id` for subsequent retrieval. `file_url` is relative to
the API origin. Duplicate uploads intentionally create separate records; business duplicate
detection belongs to Kalent's release 2 work.

Processing statuses: `reading`, `extracting`, `checking`, `completed`, `failed`. A completed
job can contain mismatches or review flags. Every response includes `mode`; display a visible
fixture/demo indicator in the frontend. Do not present fixture output as an AI result.

Line statuses: `match`, `price_mismatch`, `unknown_part`, `needs_person`. The proposed result
contains both unit prices, signed per-unit difference, and known overcharge. `null` means
unavailable, not zero. Fixture invoice 2 has a 0.003 unit-price difference on 5,000 parts,
giving SGD 15.00 overcharge. Fixture invoice 8 is an undercharge: mismatch, zero overcharge.

CORS allows localhost/127.0.0.1 on port 3000. HTTP errors use `detail`; processing failures
include `error` on the saved record. Original document bytes, SQLite and results are stored
under ignored `backend/runtime/`. Change this with `INVOICE_DATA_DIR`. Don't expose this local
storage through a public static directory.

## Owners and proposed contracts

| Location | Purpose / owner |
| --- | --- |
| `schema.py` | Proposed build-plan invoice fields; Chen Meng/team must agree the contract |
| `read/` | Duc: PDF validation, native text, OCR, tables, per-page metadata |
| `api/` | Duc: service orchestration, persistence, adapter interfaces; `api/live.py` joins the real steps |
| `extract/` | Chen Meng: one model call turns page text into `InvoiceRecord` |
| `check/` | Kalent: price sheet loader, line rules, allowance, overcharge total |
| `eval/` | Chen Meng: the scorer, `invoice-score` |
| `dummy/` and `../data/dummy/` | Duc: generator, invented price sheet and documents |
| `examples/` | Concrete handoffs for Chen Meng, Kalent and Nam |
| `invoice_processing/` | Earlier experiment, retained for reference; not used by the service |

`schema.py` is a proposal, not a claim of all four owners' approval. It follows the plan's
field list and uses nullable values and decimal strings (e.g. `0.0047`). It does not require
supplier tax IDs, discounts, expected invoice quantities, or our previous evidence wrappers.
Reader provenance stays separate. Do not change the field list casually while teammates build.

The master is a **part price sheet**, not an invoice register. The service never uses the
earlier `MasterSnapshot`/`compare_invoice` experiment. Kalent supplies the real sheet loader,
currency/matching policy, arithmetic rules, rounding allowance and overcharge computation.

`api.live.LiveStages` is that object for the real steps, and `INVOICE_MODE=live` selects it.
Any other object implementing `api.stages.Stages` can be passed the same way:

```python
class TeamStages:
    mode = "live"
    price_sheet_version = "hash-of-the-immutable-sheet-used-by-this-adapter"

    def extract(self, document):
        return chen_meng_extract(document)  # returns schema.InvoiceRecord

    def check(self, invoice):
        return kalent_check(invoice)       # returns api.contracts.CheckResult

app = create_app(stages=TeamStages())
```

Initialize adapters with a specific immutable sheet snapshot. The API validates one result
per line and a matching sheet version. Keep provider keys in backend environment variables.
The older `invoice_processing` OpenAI experiment is not used. The live adapter uses `extract/`
with a separate extended checking schema, preserving the original field-only handoff.
Reading warnings must be carried into Chen Meng's uncertainty handling and Kalent's review
results when those adapters are integrated.

## PDF handoff

```sh
.venv/bin/invoice-read ../data/dummy/invoice-02.pdf --out artifacts/page-text.json
```

The output includes document SHA-256, page text with Markdown tables, page numbers,
`ocr_ran`, extraction method, warnings, recognized OCR-cell count, stable block IDs,
coordinates, and the original Docling documents for each page.

Each page is inspected for embedded text first. A textless page runs full-page OCR;
otherwise OCR is disabled. Mixed digital/scanned documents therefore use different paths
per page. A page containing both a small native-text header and a scanned table may need
the explicit forced-OCR override: automatic within-page region routing is not implemented.
The `mixed` method value is reserved for that future behavior. Blank/unreadable pages are
retained with warnings, not silently dropped. Failed page conversions fail the document.

Tables keep table-level provenance; do not mistake that for precise cell boxes. IDs include
page prefixes to avoid collisions. Keep page dimensions and coordinate origins when adding
highlighting. Limits: local unencrypted PDFs, 20 MiB, 30 pages. The service validates bytes
and stores under random IDs, not upload filenames.

## Dummy set and generator

`data/dummy/` contains a numeric Excel price sheet, ten digital invoices across three layouts,
ten image-only copies, and `manifest.json` with every printed field, deliberately planted
mistake, fixture response, and file hash. The workbook is a committed source asset; the
generator reuses it and verifies it against `dummy.cases.CATALOG`. A custom output folder
receives a copy. It never reads a real price sheet or writes through Kalent's loader.

HTML layouts are rendered by WeasyPrint. On macOS install `brew install pango` first; if
library discovery fails, set `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. On Linux install
WeasyPrint's platform dependencies per its official documentation. Then, from `backend/`:

```sh
.venv/bin/invoice-dummy
# Or keep a separate generated copy:
.venv/bin/invoice-dummy --out runtime/dummy-rebuild
```

Regeneration refreshes PDF hashes in the manifest. Restart fixture mode afterward to load
the new manifest. Expected values come from the source records before rendering, never from
OCR output. Chen Meng owns the final answer-file format/scorer; the manifest is a handoff,
not the three-run evaluation or its five metrics.

## The price check's rules

Each line takes the first rule it fails: a missing quantity, unit price or line total; a
quantity of zero or less; quantity times price not equal to the line total; no part number or
a part not on the sheet (`unknown_part`); a part the sheet prices twice; a missing or
different currency; then the price. A gap worth less than `check/allowance.py` on the line is
a match. An invoice whose own sums disagree stops every line and claims no overcharge. Only
what the invoice prints is compared, so an invoice with no tax line is checked on its total.

`overcharge_total` is the sum of the known overcharges. Lines with no known price are left
out of it and counted in `warnings`, for example `"1 line not priced"`.

The sheet loader reads the first worksheet, finds the header row within the first 20 rows,
and accepts the header wordings listed in `check/sheet.py`. Add a client's wording there.

## Score

```sh
.venv/bin/invoice-score                 # the dummy set, three runs, needs the key and model
.venv/bin/invoice-score --manifest PATH --price-sheet PATH --runs 1
```

It prints, for digital and scanned files apart: fields read correctly, check results equal to
the answer file, planted mistakes caught, correct lines left unflagged, cost and seconds per
invoice, then every miss. An invoice a step refuses is scored as wrong and listed. The run is
saved under `artifacts/` and ends with an error when a planted mistake is missed.

## Verify

```sh
.venv/bin/pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check api check eval extract read dummy schema.py tests
.venv/bin/pytest -q --run-docling
.venv/bin/pytest -q --run-model      # one real model call on data/dummy; needs the key
```

Unit tests cover persistence across app restarts, interrupted jobs, invalid/oversized uploads,
busy service behavior, fixture hash restrictions, source truth, workbook contents and image-only
scans. Optional model-backed tests verify digital reading, actual OCR and mixed-page routing.
The handwritten/known fixture outputs do not demonstrate extraction accuracy.

For release 1, a process restart marks unfinished jobs failed rather than silently retrying
billable work. Durable retries, multiworker deployments, user decisions, Excel result exports,
and the frontend remain outside this implementation.

References: [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/),
[Docling pipeline options](https://docling-project.github.io/docling/reference/pipeline_options/),
[WeasyPrint setup](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html).
