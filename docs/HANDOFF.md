# Where the work stands

Written 11 October 2026 for whoever continues, person or AI assistant. Update this file when you
stop, so the next reader starts from the truth.

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
