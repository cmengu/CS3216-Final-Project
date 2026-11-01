# API map: Invoice Checker service

The backend endpoints behind the three core features: master list, invoice upload, and the check with its resolution.

## Source

- **No Swagger/OpenAPI file is committed.** The service is FastAPI (`backend/api/app.py`), which generates its spec at runtime.
  - A running service serves it at **`GET /openapi.json`**, with Swagger UI at **`GET /docs`** (FastAPI defaults; not overridden).
  - This map comes from `create_app().openapi()` (OpenAPI 3.1.0, title "Invoice Checker", version 0.1.0) and from the handler code.
  - Each resolution rule was also exercised against the service in fixture mode on 20 Oct 2026.
- **Base URL:** `NEXT_PUBLIC_INVOICE_API`, default `http://127.0.0.1:8001`. The frontend client is `src/checker/api.ts`.
- **CORS:** explicit configured frontend origins (plus local development origins); credentialed requests support GET/POST/PUT/PATCH/DELETE and the browser protection header.
- **Errors:**
  - Handler errors are `{"detail": "<one sentence>"}`.
  - FastAPI's own validation errors are `422 {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`.
- **Numbers:** money, quantities and rates are **decimal strings** matching `^-?\d+(?:\.\d+)?$`, or `null`. They are never JSON numbers.

## Summary of what exists

| Area | Endpoints | Status |
|---|---|---|
| Approved accounts | `/auth/*`, `/admin/accounts` | Administrator-managed private accounts and registered sessions. |
| Master list upload / import / read | `GET/POST/PUT /master-list`, `POST /master-list/preview`, `GET /master-list/events`, `GET /master-list/versions/{version}` | Persisted CSV/XLSX/XLS imports; live checks use a fixed uploaded version. |
| Invoice upload | `POST /invoices`, `POST /invoice-batches` | Immediate compatibility API and durable batch API. |
| Invoice read | `GET /invoices`, `GET /invoices/{invoice_id}`, `GET /invoices/{invoice_id}/file` | Built |
| Discrepancy check | **No separate endpoint.** Runs inside immediate uploads or the durable batch worker. | Built |
| Discrepancy resolution | `PUT /invoices/{invoice_id}/outcome` (per invoice, not per line) | Built |
| Health | `GET /health` | Built |

---

## 1. Approved-account authentication

Only approved active accounts can sign in. Authentication uses a signed HttpOnly cookie and a
registered server-side login session, with a separate persistent account/workspace identity.
The backend requires an independent `AUTH_SECRET`; there are no public demo credentials or
offline browser login fallback. First-admin setup verifies the operator-configured email before accepting a password. No environment password or setup token is required.
Username/email aliases share the same failed-login allowance. Exact existing usernames take precedence over email aliases; password verification never falls back to a second account.
Passwords use salted Argon2id. Tokens are invalidated by logout and account access/password changes.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/auth/setup-status` | Whether first-admin setup is pending |
| POST | `/auth/setup/start` | Send a five-minute code only to the configured administrator email; no account is created |
| POST | `/auth/setup/verify` | Verify that code and return a single-use, five-minute password-creation grant; no login/account yet |
| POST | `/auth/setup/resend` | Resend to the same approved inbox after cooldown; retire the old code challenge |
| POST | `/auth/setup/complete` | Verified setup grant plus chosen username/password; atomically create the first administrator and issue an email-verified session |
| POST | `/auth/setup` | Retired token/password setup endpoint; returns 410 |
| POST | `/auth/sign-in` | Approved username or registered email plus password; return an expiring MFA challenge, without a login session |
| POST | `/auth/mfa/verify` | Challenge ID plus emailed security code; verify the approved inbox and issue the session cookie |
| GET | `/auth/mfa/status` | Verified account's registered security email and verification state |
| POST | `/auth/mfa/resend` | Existing unexpired challenge; send a new code to the same registered email after the cooldown |
| GET | `/auth/me` | Verify the registered, unexpired, unrevoked account session |
| POST | `/auth/sign-out` | Revoke the current login and clear its cookie |
| PUT | `/auth/password` | Verify current password, replace it, and invalidate all sessions |
| POST | `/auth/password-reset/start` | Email-only recovery request; send only to a registered active account's inbox; generic response for unknown/pending/disabled emails |
| POST | `/auth/password-reset/resend` | Existing reset challenge; resend to the same inbox after cooldown |
| POST | `/auth/password-reset/verify` | Reset challenge plus email code; return a five-minute, single-use reset grant, with no new login session |
| POST | `/auth/password-reset/complete` | Reset grant plus new password; atomically invalidate all account sessions and pending login/reset proof; no auto-login |
| GET | `/admin/accounts` | Administrators list registered accounts |
| POST | `/admin/accounts` | Administrator approves `{email}` only; no credentials/account yet |
| GET | `/admin/account-approvals` | Administrators list pending email approvals |
| DELETE | `/admin/account-approvals/{id}` | Revoke a pending approval and its codes/grants |
| POST | `/auth/enroll/start` | Request a code for a pending approved email; unknown/existing emails receive the same response without sending |
| POST | `/auth/enroll/resend` | Resend to the pending approval's email using only the current challenge |
| POST | `/auth/enroll/verify` | Verify the approved inbox; return a five-minute, single-use setup grant without an account/session |
| POST | `/auth/enroll/complete` | Grant plus self-chosen username/password; atomically consume approval, create a Member/private workspace and verified session |
| PATCH | `/admin/accounts/{id}` | Administrators enable/disable, change role or reset another account |

Every account has its own private workspace; an administrator’s invoice permissions remain
limited to that administrator’s own workspace. Account management responses never include
passwords/hashes. Delivery supports Resend (default) or explicit `AUTH_EMAIL_PROVIDER=gmail` with a private Google app password and validated Gmail SMTP TLS. Recipients remain registered account inboxes; Gmail failures never fall back to Resend.
Every approved account requires an emailed security code; password-only and
old authenticator sessions cannot access protected resources. Challenges expire after five
minutes and allow five failed attempts; persistent per-account/IP and email-send limits apply.
Resending uses only the challenge, never a caller-selected email address. Delivery failures do
not authenticate. Initial admin creation requires a verified email and atomically consumes its setup grant. Later users require an administrator-approved email and choose their credentials only after inbox proof. Enrollment grants are purpose-separated from login/admin setup, and revocation invalidates all pending proof. Duplicate emails/usernames cannot create partial accounts. Changes to an existing security
email require the audited operator CLI. Password resets preserve the registered inbox and mandatory email-code sign-in. Recovery proof is
bound to current account/email versions and becomes invalid after password, access or email
changes. Reset does not create accounts, re-enable disabled accounts or change workspaces.
There is no open registration. Login, enrollment and expensive operations have persistent
rate limits; 429 includes `Retry-After`. All browser mutations require
`X-Requested-With: InvoiceChecker` and a trusted Origin when present. Sign-in, setup and sign-out
require the header even before a session cookie exists. Unsafe requests with a cookie and an
untrusted/missing protection header return 403. Unauthenticated access to protected data returns 401;
non-admin account management returns 403. CORS supports trusted origins and GET/POST/PUT/PATCH/DELETE.

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
When explicit sheet/header/mapping options are submitted, the response also includes
optional `columnMapping` metadata with those options and the original header `columns`.
It is retained with the saved version so the UI can explain the mappings after refresh.
Prices, quantities, discount rates and tax rates are decimal strings. Validation failures return 422 with a
row-specific message; unsupported formats return 415 and files over 5 MiB return
413. Initial upload/replacement state conflicts return 409.

Original files and normalized snapshots are kept in the runtime SQLite database.
In live `master_list` mode (also selected by the old `csv_context` alias), each invoice
captures the current uploaded version before reading its PDF. Replacing the master
changes subsequent checks without a restart; saved invoices retain their previous
`price_sheet_version`, fields and results. No dummy price sheet is selected implicitly.
The UI offers an explicit recheck that creates another invoice record. Name and unit price
are required. Optional currency/unit/supplier/PO/date constraints and discount/tax terms
apply when mapped; a mapped master quantity must equal the invoice quantity. Without master
currency, the agreed price uses the invoice unit-price currency. Printed exchange rates
are required for conversion to invoice currency; ambiguous agreements require review.
Without a current master, invoice upload returns 409. Explicit legacy `standard` mode still reads its named
`INVOICE_PRICE_SHEET`. Master-list and invoice API responses use `Cache-Control: no-store`.

---

## 3. Invoice upload

### `POST /invoices`

Uploads one PDF or Vietnamese HDon XML invoice, then **reads, extracts and checks it in the same request** and returns the saved result. The request can take a minute in live mode. ZIP/RAR archives are unpacked locally and submitted together through `/invoice-batches`. XML fields are mapped directly without OCR/model calls; the same master-list checks and review safeguards apply.

**Request**

- `Content-Type: multipart/form-data`, field **`file`** (required, binary).
- Query `force_ocr` (boolean, default `false`): run OCR even when the PDF has embedded text.

**Accepted files**

- **PDF or Vietnamese HDon XML.** The filename must end in `.pdf` or `.xml`; otherwise 415. XML requires live mode; fixture mode returns 422. Unknown XML vocabularies, malformed XML and DTD/entity declarations return 422 before anything is saved.
- **Up to 20 MiB.** Otherwise `413 "Invoice exceeds 20 MiB"`. Before reading, a `Content-Length` over 20 MiB + 64 KiB gets `413 "Upload exceeds 20 MiB"`.
- **PDF: 1 to 30 pages**, and it must be a valid PDF. Otherwise `422` with the reason, for example "PDF must contain 1–30 pages".

**Responses**

| Status | Body | When |
|---|---|---|
| `201` | `SavedInvoice` | Read, extracted and checked. `status: "completed"`. |
| `422` | `SavedInvoice` | The file was saved but a step failed. `status: "failed"`; `error` names the step and the reason, for example `"reading: …"`, `"extracting: …"` or `"checking: …"`. |
| `422` | `{"detail": "..."}` | Invalid PDF (page count, unreadable). Nothing saved. |
| `413` | `{"detail": "..."}` | Over 20 MiB. |
| `415` | `{"detail": "Upload a PDF or Vietnamese HDon XML invoice"}` | Not a `.pdf` or `.xml`. |
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

The original PDF or XML exactly as uploaded.

- **200:** PDF: `application/pdf`, inline disposition. XML: `application/xml`, attachment disposition. Both keep the original name; XML uses `X-Content-Type-Options: nosniff`.
- **404:** `"Invoice not found"` or `"Original invoice is unavailable"`.

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

## Durable batch upload

`POST /invoice-batches` accepts an optional owned `project_id` query and receives multipart `files`: 1–1,000 invoices, at most 20 MiB per file
and 100 MiB total. It validates the complete batch, reserves storage/usage allowance, pins the
current master version, and persists source files and jobs before returning **202**:
`{id, invoices: SavedInvoice[], duplicates: [{filename, existing_id}], processing: "background"}`.
New records have status `queued`, then use the existing reading/extracting/checking/completed/failed
pipeline. Exact previously uploaded content is skipped; there is no business-number duplicate guarantee.
Invalid files reject the batch before job creation; 413 signals a file/batch/storage limit;
429 signals an allowance limit. The browser must stay open until upload is acknowledged.

`GET /invoice-batches/{id}` returns `{id, invoice_ids, total, queued, processing, completed, failed}`
for the owner only; another account receives 404. Results also appear in the ordinary invoice list.
Queued jobs survive a service restart. In-progress jobs recover after an expired lease with at most
three attempts; stale workers cannot overwrite results. Processing needs an available backend and
persistent database/files. The legacy `POST /invoices` endpoint retains its immediate 201/422 contract.
