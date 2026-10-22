# Where the work stands

Written 11 October 2026 for whoever continues, person or AI assistant. Update this file when you
stop, so the next reader starts from the truth.

## Implemented, 23 October 2026

Follow-up: the recheck prompt now requires a differing master-list version saved after
the invoice upload. Legacy file-based version differences alone no longer imply that
the user replaced the master list. Chrome verified canceling both an empty replacement
dialog and a file preview leaves the prompt hidden, while confirming a newer upload
shows it. All 106 frontend tests, TypeScript and source lint passed; full-repository lint
encountered an EPERM error scanning `backend/.pytest_cache`. See S-37 in
`docs/review/2026-10-23-screens.md`.

The upload/cache, reusable master-list integration and flat-fee issues recorded below
are now resolved. This section is the current status; earlier sections retain the audit history.

- Master-list reads cannot overwrite a newer save or newer read. Saves are serialized
  within a tab, confirmed data is shown immediately, and focus/visibility/storage events
  refresh sibling tabs. Invoice reads also retain newer local mutations. API reads use
  no-store and bounded timeouts; AI preview has a separate 60-second client timeout.
- Every import now requires mapping review, including files with `item`/`unit_price`.
  Quantity is preserved, uncertainty notes are shown, and the first worksheet with a
  complete proposed mapping is selected. Decimal discount/tax fields and validity
  intervals are validated. Missing currency/unit information remains a review condition.
- Live mode defaults to `INVOICE_CHECKER=master_list`; `csv_context` is a compatibility
  alias. These modes use the uploaded normalized list, without a CSV path or dummy
  fallback. Explicit `standard` mode retains its configured legacy file checker.
- Each invoice binds an immutable master snapshot before reading the PDF. Replacements
  affect subsequent uploads immediately. Historical snapshots are available at
  `GET /master-list/versions/{version}`; old comparisons show their original version.
  Recheck with current master list creates a new invoice and preserves the prior result.
- The foreign flat-fee case is handled only for a unique code-free per-JOB agreement
  with reconciling printed amounts. Missing exchange rates and missing-quantity products
  remain review cases. Numeric SKUs and equivalent m3/m³ spellings are supported.

Validation: 171 backend tests passed, 4 optional model/OCR tests skipped; all 102 frontend
tests, backend Ruff checks, frontend lint, TypeScript and production build passed. An
additional real OCR/OpenAI upload of `F01_freight_tax_02.pdf` returned 201, one correct
price mismatch, six matches, no warnings and SGD 20.96 overcharge; the origin fee matched.
Chrome checks verified explicit mapping review, retained quantity, same-name replacements,
failed replacement preservation, automatic second-tab refresh, original-version comparison
and the recheck control, with no page errors or mobile horizontal overflow. Live and browser
tests used a separate review backend/database and did not change the active master list.

Restart the running backend to load the changes. Existing `csv_context` configuration
continues to work; its old `INVOICE_PRICE_SHEET` value is no longer used. Review the uploaded
unit/currency mappings before checking a new dataset. The remaining historical “not done”
items below predate this implementation and are not a current release checklist.

## Follow-up, 22 October 2026

- **KIV: make master data reusable across datasets.** Reuse the column mapper in
  `backend/api/master_mapping.py` and the import normalization in `master_import.py` to
  feed a common price-agreement model into the invoice checker. Import already supports
  different column headings, but checking still reads `INVOICE_PRICE_SHEET` and expects
  the fixed CSV columns in `api/csv_live.py`. Decide how to handle missing supplier, PO,
  unit, currency, tax and validity fields; do not invent values to make a match. Preserve
  the actual master snapshot/version used for each check and address the implicit dummy
  sheet fallback before using this with unrelated datasets. Integration is not implemented.
- **Upload/cache/mapping audit after user clarification.** Repeated master-list replacement
  works, including changed contents with the same filename: isolated API checks returned
  POST 201, repeated POST 409, PUT 200, PUT 200, invalid PUT 422, with the last valid data
  preserved. Only one master list is active; importing is not an append operation. The
  invoice upload queue separately blocks identical PDF hashes, including previous attempts.
  A frontend race was reproduced: an old `refreshMasterList()` GET completing after a
  successful replacement overwrites the newer cached list. There is also no refresh on
  window focus or another tab's updates. Neither issue is fixed. Check the user's exact
  reproduction before attributing their friend's stale display to one cause.
  The `MasterImport` demo shortcut auto-saves files containing `item` and `unit_price`
  without mapping review and deletes the quantity mapping; remove this for general use.
  Mapping uncertainty notes from preview are not currently shown in that component.
  Live preview probes correctly mapped reordered CSV columns with separate unit/total
  prices, XLSX title rows and multiple sheets, Vietnamese headings without quantity, and
  a legacy XLS fixture. These small samples are not an accuracy benchmark. The XLS probe
  initially failed because declared dependency `xlrd` was missing; `uv sync --locked`
  installed it and the probe then passed. All 29 backend master-list/mapping tests and
  23 frontend master-list/API tests passed. These checks left the active master unchanged.
- **Confirmed flat-fee extraction bug, not yet fixed.** In the live test of
  `F01_freight_tax_02.pdf`, the model extracted the origin fee as CNY `1230.00`, with
  exchange rate `0.180000`, billed SGD `221.40`, no quantity/unit, and
  `flat_charge=false`. The checker cannot identify the per-JOB agreement and returns
  `needs_person`; this also leaves invoice-level `overcharge_total` null. Offline replay
  with only `flat_charge=true` makes this fee match and produces the expected invoice
  overcharge of SGD `20.96`. This diagnoses the classification problem; do not force
  missing-quantity products into flat charges. An explicit printed exchange rate remains
  necessary for a foreign-currency amount. The saved invoice was not modified.

## State

`main` holds the whole invoice checker: the PDF reader, the service, the model step, the price
check, the scorer and the Invoices screens. Pull requests #1 to #14 are merged or closed, and
no pull request is open. Start new work from `main`.

Checks on `main`, run after the last merge on 11 October 2026: backend `pytest -q` gives 96
passed and 4 skipped; screens `npm test` gives 184 passed; lint and typecheck are clean on
both.

The branches `duc/invoice-service`, `feature/invoice-list` and `sample-po-lists` are still on
GitHub. Everything in them is on `main`; their owners can delete them.

## What works

- Upload a PDF on the Invoices page, see it in the list, open its page.
- The service on replayed answers for the 20 dummy PDFs: `INVOICE_MODE=fixture`.
- The service on the real steps: `INVOICE_MODE=live` with `INVOICE_PRICE_SHEET=<path>`,
  `OPENAI_API_KEY` and `OPENAI_MODEL`.
- The price check, the price sheet loader and the scorer, each with tests.

## What has not been done

- **No run against a real model.** No key was available. Live mode and `invoice-score` are
  tested with a stand-in for the model step only, so there are no accuracy numbers yet.
- **The upload step of `scripts/e2e.mjs` was not run in a browser** after the last changes.
- **The mock invoice set is not handled yet.** See "Next" below.
- **The checker does not use the uploaded master list.** Invoices are checked against the file in
  `INVOICE_PRICE_SHEET`, loaded at start-up; the list saved by `POST /master-list` is only shown.
  The uploaded list needs only name and price, but the checker matches on supplier, PO, unit,
  currency and valid dates, so the import's columns must be decided first. `csv_live.py` also
  falls back to `data/dummy/price-sheet.xlsx` for an invoice with no PO and an unknown supplier,
  and stamps the result with the main sheet's version. Both change the API, so they wait for
  the team.

## Next, in order

1. Set `OPENAI_API_KEY` and `OPENAI_MODEL`, then run `invoice-score` on `data/dummy/` and
   record the first real numbers.
2. Get the team's answer to the decisions in `docs/review/2026-10-11-backend.md`, section 5
   (Q-1 to Q-7). The first three decide most of the work: match by description when no part
   code is printed, add a purchase order number, unit and discount to the field list, and how
   to check a flat charge that prints only an amount.
3. Write a converter from the mock set's answer key to the scorer's answer-file format, then
   score the mock set with `invoice-score --manifest … --price-sheet …`.
4. Build the rules the team agreed to, one at a time, each with tests on invented values.
5. Tune the model's instructions in `backend/extract/invoice.py` on half the mock invoices and
   report on the other half.

The mock set is 14 scanned invoices, a master price sheet and an answer key. It is not in this
repo. Ask Chen Meng for the zip and unpack it to `data/private/mock_invoice_dataset/`, which
git ignores. Measured on 11 October: the reader's text holds 57 of 58 line amounts, and the
price check with perfectly read fields is right on 16 of 58 lines.

## Open points for each owner

`docs/review/2026-10-11-backend.md` and `docs/review/2026-10-11-screens.md` list every edit
made in the last review (B- and S- notes) and every disagreement left for an owner (BD- and
SD- notes). The ones that matter most:

- **Duc:** SD-01, the list needs supplier, number and overcharge on the service's summary.
  BD-01, the check's result type lives in the service package.
- **Kalent:** confirm the rule changes B-04, B-06 and B-07.
- **Nam:** SD-03, wording and layout against the PRDs. SD-04, the walk can pass when upload is
  broken. SD-08, the side menu still says "PO Tracker".
- **Chen Meng:** BD-03, the model is always sent `temperature=0`. Q-7, whether the mock set may
  be published.

## Rules

- Every edit and every disagreement gets a numbered note in `docs/review/<date>-<area>.md`.
- One feature per branch and per pull request. Nothing is pushed to `main` directly.
- `backend/schema.py` and `backend/api/contracts.py` change only when the team has agreed.
- No real invoice, real price, client name or key enters the repo. `data/private/` is ignored
  for that purpose.
- A step that cannot do its job fails with a reason. It never falls back to a made-up answer.

## Run and check

```sh
# service, from backend/
uv sync --locked --extra dev --extra docling --extra dummy
INVOICE_MODE=fixture .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000 --workers 1
.venv/bin/pytest -q && .venv/bin/ruff check .

# screens, from the repo root
npm install && npm run dev
npm test && npm run typecheck && npm run lint
```
