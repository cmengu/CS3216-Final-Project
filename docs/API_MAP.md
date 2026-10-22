# API map: Invoice Checker service

The backend endpoints behind the three core features: master list, invoice upload, and the check with its resolution.

## Source

- **No Swagger/OpenAPI file is committed.** The service is FastAPI (`backend/api/app.py`), which generates its spec at runtime.
  - A running service serves it at **`GET /openapi.json`**, with Swagger UI at **`GET /docs`** (FastAPI defaults; not overridden).
  - This map comes from `create_app().openapi()` (OpenAPI 3.1.0, title "Invoice Checker", version 0.1.0) and from the handler code.
  - Each resolution rule was also exercised against the service in fixture mode on 20 Oct 2026.
- **Base URL:** `NEXT_PUBLIC_INVOICE_API`, default `http://127.0.0.1:8000`. The frontend client is `src/checker/api.ts`.
- **CORS:** origins `http://localhost:3000` and `http://127.0.0.1:3000`; methods `GET`, `POST`, `PUT`; request header `Content-Type` only.
- **Errors:**
  - Handler errors are `{"detail": "<one sentence>"}`.
  - FastAPI's own validation errors are `422 {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`.
- **Numbers:** money, quantities and rates are **decimal strings** matching `^-?\d+(?:\.\d+)?$`, or `null`. They are never JSON numbers.

## Summary of what exists

| Area | Endpoints | Status |
|---|---|---|
| Auth (email/password, OAuth) | **None** | Not built. The service says "No auth/connectors in release 1". |
| Master list upload / import / read | `GET/POST/PUT /master-list`, `POST /master-list/preview`, `GET /master-list/events`, `GET /master-list/versions/{version}` | Persisted CSV/XLSX/XLS imports; live checks use a fixed uploaded version. |
| Invoice upload | `POST /invoices` | Built |
| Invoice read | `GET /invoices`, `GET /invoices/{invoice_id}`, `GET /invoices/{invoice_id}/file` | Built |
| Discrepancy check | **No separate endpoint.** Runs inside `POST /invoices`. | Built |
| Discrepancy resolution | `PUT /invoices/{invoice_id}/outcome` (per invoice, not per line) | Built |
| Health | `GET /health` | Built |

---

## 1. Auth

**There are no auth endpoints.** The API accepts every request without credentials. There is no email/password, OAuth, session, token or user model on the service.

The app's "sign-in" is a **client-side demo**, not authentication:

- **Where:** `/who` (`src/components/pages/WhoGate.tsx`).
- **How it works:** the person picks one of five invented people. Owner and Finance must type a PIN, and the demo accepts any four digits (`pinOk` in `src/platform/access.ts`).
- **What it stores:** the choice in `sessionStorage` (`pot-who`) and in the demo state in `localStorage` (`pot-demo-v3`).
- **What it controls:** which pages show (Invoices is limited to Owner and Finance). Nothing is sent to the service.

**For the redesign:** real sign-in (email/password and/or OAuth) needs new backend work. Nothing exists to wire to.

---

## 2. Master-list import

The frontend master-list page uploads real CSV, XLSX and XLS files to the backend.
It uses the configured OpenAI model to suggest header rows and column mappings, previews worksheet rows and lets the user map arbitrary headings to required
`name` and `price` (unit price) fields, plus optional `quantity`. Optional metadata is null when
unmapped or blank. No browser seed/localStorage data is used.

| Endpoint | Purpose |
|---|---|
| `POST /master-list/preview` | Multipart file; return worksheets, AI header/mapping suggestions and source preview |
| `POST /master-list` | Initial import; multipart file and optional JSON `options` with sheet/header/mapping |
| `PUT /master-list` | Replace only after all rows pass validation |
| `GET /master-list` | Persisted current list or null |
| `GET /master-list/events` | Upload/replacement history |
| `GET /master-list/versions/{version}` | Original immutable snapshot; 404 when unavailable |

The response retains `file`, `uploadedAt`, `items`, `supplierCount`, and adds `id`
and `version`. Each item contains required name/price, nullable quantity, computed totalPrice and nullable
supplier, po, item, description, unit, currency, discount, tax, validFrom, validTo.
Prices, quantities, discount rates and tax rates are decimal strings. Validation failures return 422 with a
row-specific message; unsupported formats return 415 and files over 5 MiB return
413. Initial upload/replacement state conflicts return 409.

Original files and normalized snapshots are kept in the runtime SQLite database.
In live `master_list` mode (also selected by the old `csv_context` alias), each invoice
captures the current uploaded version before reading its PDF. Replacing the master
changes subsequent checks without a restart; saved invoices retain their previous
`price_sheet_version`, fields and results. No dummy price sheet is selected implicitly.
The UI offers an explicit recheck that creates another invoice record. Currency and unit
must be mapped to compare prices; absent values and ambiguous agreements require review.
Supplier/PO/date constraints and discount/tax terms apply when mapped. Without a current
master, invoice upload returns 503. Explicit legacy `standard` mode still reads its named
`INVOICE_PRICE_SHEET`. Master-list and invoice API responses use `Cache-Control: no-store`.

---

## 3. Invoice upload

### `POST /invoices`

Uploads one invoice PDF, then **reads, extracts and checks it in the same request** and returns the saved result. The request can take a minute in live mode.

**Request**

- `Content-Type: multipart/form-data`, field **`file`** (required, binary).
- Query `force_ocr` (boolean, default `false`): run OCR even when the PDF has embedded text.

**Accepted files**

- **PDF only.** The filename must end in `.pdf`; otherwise `415 "Upload a PDF"`.
- **Up to 20 MiB.** Otherwise `413 "PDF exceeds 20 MiB"`. Before reading, a `Content-Length` over 20 MiB + 64 KiB gets `413 "Upload exceeds 20 MiB"`.
- **1 to 30 pages**, and it must be a valid PDF. Otherwise `422` with the reason, for example "PDF must contain 1–30 pages".

**Responses**

| Status | Body | When |
|---|---|---|
| `201` | `SavedInvoice` | Read, extracted and checked. `status: "completed"`. |
| `422` | `SavedInvoice` | The file was saved but a step failed. `status: "failed"`; `error` names the step and the reason, for example `"reading: …"`, `"extracting: …"` or `"checking: …"`. |
| `422` | `{"detail": "..."}` | Invalid PDF (page count, unreadable). Nothing saved. |
| `413` | `{"detail": "..."}` | Over 20 MiB. |
| `415` | `{"detail": "Upload a PDF"}` | Not a `.pdf`. |
| `429` | `{"detail": "An invoice is processing; retry after it finishes"}` | Another upload is running. One at a time; `Retry-After: 5`. |
| `503` | `{"detail": "..."}` | `INVOICE_MODE` not set. |
| `400` | `{"detail": "Invalid Content-Length"}` | Bad header. |

The frontend treats both `201` and a `422` that carries an `id` as "saved" (`uploadInvoice` in `src/checker/api.ts`).

---

## 4. Invoice read

### `GET /invoices`

Lists saved invoices, **without** document, extracted fields or check lines.

- **Query:** `limit` (integer 1–100, default 50) and `offset` (integer ≥ 0, default 0).
- **200:** `InvoiceSummary[]`.
- The frontend pages through 100 at a time, then fetches each invoice by ID for its details.

### `GET /invoices/{invoice_id}`

One invoice in full.

- **Path:** `invoice_id`, a UUID.
- **200:** `SavedInvoice`.
- **404:** `{"detail": "Invoice not found"}`. A non-UUID ID gets FastAPI's `422`.

### `GET /invoices/{invoice_id}/file`

The original PDF exactly as uploaded.

- **200:** `application/pdf`, `Content-Disposition: inline; filename=<original name>`.
- **404:** `"Invoice not found"` or `"Original PDF is unavailable"`.

---

## 5. The discrepancy check

**There is no separate check endpoint.** The check runs inside `POST /invoices` against the master list loaded at start-up, and its result is stored on the invoice as `SavedInvoice.check`.

- **To re-check, upload the PDF again.** The frontend's "Try again" (`retryInvoice`) downloads `/file` and re-uploads it, which **creates a new invoice ID**. The old record is kept.
- **The service guarantees:**
  - exactly one `LineResult` per extracted invoice line (`line_index` 0…n-1);
  - `check.price_sheet_version` equals the loaded sheet's version.

### Line results (`LineResult.status`)

| Status | Meaning |
|---|---|
| `match` | The price agrees with the master list. |
| `price_mismatch` | The price differs by more than 0.005. `difference` > 0 is an overcharge; `difference` < 0 is an undercharge (both are flagged). |
| `unknown_part` | No master-list row for this part. |
| `needs_person` | The service won't decide, for example a conflicting sheet price, no part number with no exact description match, or an unclear amount. `reason` says why. |

`CheckResult.overcharge_total` is `null` whenever the check is incomplete or uncertain. The service never reports a partial total.

---

## 6. Discrepancy resolution

### `PUT /invoices/{invoice_id}/outcome`

Saves the AP clerk's decision **for the whole invoice**, or clears it.

- **There is no per-line resolution:** no endpoint accepts, overrides or edits a single line, and none edits the master list.
- **Request:** `Content-Type: application/json`

  ```json
  { "outcome": "ready_to_pay" | "ready_to_pay_anyway" | "raise_with_supplier" | null,
    "reason": "string up to 500 characters" | null }
  ```

- **200:** `SavedInvoice` with `outcome`, `outcome_reason` and `decided_at` set (or cleared).

### The exact actions and their rules

Each rule below was verified against the service.

| Outcome | Allowed when | Refused with |
|---|---|---|
| `"ready_to_pay"` | The invoice is `completed`, `check.overcharge_total` is not null, there is at least one line, and **every** line is `match`. No reason needed. | `409 "Only an invoice checked in full with every line matching is ready to pay"` |
| `"ready_to_pay_anyway"` | The invoice is `completed` **or `failed`**, and `reason` is non-empty. | `422 "Ready to pay anyway needs a short reason"` |
| `"raise_with_supplier"` | The invoice is `completed`, and at least one line is `price_mismatch` with a **positive** `difference` (an overcharge). | `409 "Raise with supplier needs a line priced over the sheet"` |
| `null` (undo / clear) | Always, as long as `reason` is empty. | `422 "Clearing an outcome takes no reason"` |
| *any* | — | `409 "The invoice is still being checked; decide once the check has finished"` if its status is `reading`, `extracting` or `checking`. `404 "Invoice not found"`. |

**How the frontend uses outcomes:**

- An invoice with no `outcome` is in the **To decide** pile; one with an outcome is **Done**.
- `ready_to_pay` and `ready_to_pay_anyway` invoices export to CSV.
- `raise_with_supplier` produces a dispute note to copy.
- Nothing is sent to the supplier by the app.

---

## 7. Health

### `GET /health`

```json
{ "status": "ok", "mode": "fixture" | "live" | "unconfigured", "processing_configured": true, "contract": "proposed-v1" }
```

---

## 8. Schemas

All fields are listed; `?` marks a field that may be `null`. "dec" is a decimal string.

**`InvoiceSummary`** (list rows)

- `id` (string, UUID)
- `filename` (string)
- `document_hash` (string, SHA-256)
- `status`: `"reading" | "extracting" | "checking" | "completed" | "failed"`
- `mode` (string: `fixture` or `live`)
- `created_at`, `updated_at` (ISO strings)
- `error?` (string)
- `price_sheet_version` (string)
- `outcome?`: `"ready_to_pay" | "ready_to_pay_anyway" | "raise_with_supplier"`
- `outcome_reason?` (string)
- `decided_at?` (ISO string)

**`SavedInvoice`** = every `InvoiceSummary` field, plus:

- `document?` (`ParsedDocument`): what the reader saw.
- `invoice?` (`CheckingInvoice` or `InvoiceRecord`): the extracted fields.
- `check?` (`CheckResult`)
- `file_url` (string): the service's own path to the PDF.

**`CheckingInvoice`** (extracted fields; `InvoiceRecord` is the same set without `purchase_order`, `tax_rate` and `warnings`)

- `supplier_name?`, `invoice_number?`, `invoice_date?`, `currency?`, `purchase_order?`
- `subtotal?`, `tax?`, `tax_rate?`, `invoice_total?` (dec)
- `lines` (`CheckingLine[]`)
- `warnings` (string[])

**`CheckingLine`**

- `part_number?`, `description?`, `unit?`, `currency?`
- `quantity?`, `unit_price?`, `line_total?`, `exchange_rate?`, `discount_rate?`, `discount_amount?` (dec)
- `flat_charge` (boolean)

`InvoiceLine` (in `InvoiceRecord`) has only `part_number?`, `description?`, `quantity?`, `unit_price?` and `line_total?`.

**`CheckResult`**

- `price_sheet_version` (string)
- `lines` (`LineResult[]`, one per invoice line)
- `overcharge_total?` (dec; `null` when the check is incomplete or uncertain)
- `warnings` (string[])

**`LineResult`**

- `line_index` (integer ≥ 0)
- `status`: `"match" | "price_mismatch" | "unknown_part" | "needs_person"`
- `reason` (string, plain sentence)
- `invoice_price?`, `agreed_price?`, `difference?`, `overcharge?` (dec)

**`OutcomeRequest`**

- `outcome?`: `"ready_to_pay" | "ready_to_pay_anyway" | "raise_with_supplier"`
- `reason?` (string, at most 500 characters)

**`ParsedDocument`**

- `schema_version` (`"1"`), `document_hash`, `filename`, `page_count`, `reader_version`
- `markdown` (string)
- `blocks` (`SourceBlock[]`: `id`, `text`, `locations[]` of `{page, bbox?, page_width?, page_height?}`)
- `pages` (`PageRead[]`: `page_number`, `extraction_method` of `"embedded_text" | "ocr" | "mixed"`, `ocr_ran`, `embedded_characters`, `ocr_cells`, `markdown`, `block_ids`, `warnings`)
- `docling_document` (object)

---

## 9. Gaps for the three-feature redesign

| Needed for | Missing on the service |
|---|---|
| Sign-in | Any auth: users, email/password, OAuth, sessions. Requests are unauthenticated. |
| Master list per supplier | Any supplier entity. One list serves every supplier; the CSV format holds suppliers as rows. |
| Check: re-run | A re-check endpoint. Re-checking means re-uploading, which creates a new invoice. |
| Resolution per line | Line-level actions (accept a line, override a price, mark resolved). Only the whole-invoice outcome exists. |
| Housekeeping | Deleting an invoice. |
