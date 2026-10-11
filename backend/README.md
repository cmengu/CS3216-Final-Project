# Invoice Checker — Duc's backend

Built for the 10 October build plan: upload → Docling → extraction adapter → checking adapter
→ SQLite. Completed records and original PDFs survive a restart. The existing Next.js PO demo
is unchanged; Nam can build the new screens against this API.

**Current mode:** PDF reading is real. Extraction and checking are explicit fixture adapters
that replay expected answers for the exact generated PDFs. They do not call OpenAI or perform
live price checking, and refuse unknown PDF hashes. This lets integration start without
claiming the other owners' work is complete. Do not use fixture mode to measure AI accuracy.

## Run the local service

Python 3.12 is recommended. From `backend/`:

```sh
uv sync --locked --extra dev --extra docling --extra dummy
INVOICE_MODE=fixture .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000 --workers 1
```

Open <http://127.0.0.1:8000/docs> to upload a PDF through Swagger, or from the repository root:

```sh
curl -F 'file=@data/dummy/invoice-02.pdf' http://127.0.0.1:8000/invoices
curl http://127.0.0.1:8000/invoices
```

The first Docling run downloads model weights. Subsequent runs reuse locally cached weights
and converter instances. The reader is configured for CPU execution. No API key is needed for
fixture mode. Without `INVOICE_MODE=fixture` or injected real adapters, uploads return 503.

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
| `api/` | Duc: service orchestration, persistence, adapter interfaces |
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

Replace fixture behavior by supplying an object implementing `api.stages.Stages`:

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
The earlier OpenAI adapter is not automatically connected: its schema differs from the plan.
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

## Verify

```sh
.venv/bin/pytest -q
.venv/bin/ruff check api read dummy schema.py invoice_processing tests
.venv/bin/ruff format --check api read dummy schema.py invoice_processing tests
.venv/bin/pytest -q --run-docling
```

Unit tests cover persistence across app restarts, interrupted jobs, invalid/oversized uploads,
busy service behavior, fixture hash restrictions, source truth, workbook contents and image-only
scans. Optional model-backed tests verify digital reading, actual OCR and mixed-page routing.
The handwritten/known fixture outputs do not demonstrate extraction accuracy.

For release 1, a process restart marks unfinished jobs failed rather than silently retrying
billable work. Durable retries, multiworker deployments, user decisions, Excel result exports,
real provider integrations and the frontend remain outside this implementation.

References: [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/),
[Docling pipeline options](https://docling-project.github.io/docling/reference/pipeline_options/),
[WeasyPrint setup](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html).
