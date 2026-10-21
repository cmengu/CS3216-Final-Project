# Invoice Checker

A web app for one accountant to check supplier invoices against a master list of agreed prices, see which lines differ, and decide per invoice: Ready to pay, Raise with supplier, or Pay anyway. Read the imported files below before changing anything.

## Read first

- Rules for this repo's Next.js version: @AGENTS.md
- Product, flow and principles: @PRODUCT.md
- Design system: @DESIGN.md
- Backend endpoints and rules: @docs/API_MAP.md
- Where each piece of data shows up: @docs/TOUCHPOINTS.md
- Mistakes already made here: @docs/PITFALLS.md
- Approved screens (HTML, reference only, never imported into the app): `docs/design/`

## Non-negotiables

1. **Never guess.** If the check is unsure, show it as needing the person, with the reason. Never fall back to "Matches".
2. **"Ready to pay" must be safe to pay.** Only offer it when the invoice is completed, `check.overcharge_total` is not null, there is at least one line, and every line is `match`. A bug that shows "Matches" or offers "Ready to pay" wrongly is the most serious kind of bug in this app.
3. **Money is the service's.** Display the figures the API returns. Never compute an overcharge in the browser.
4. **Only offer actions the API accepts.** The 409 rules in `docs/API_MAP.md` are the UI rules.
5. **One source per fact.** Status labels, outcome rules and money formatting each live in one module. Screens import them; they never re-derive them.

## Locked

The design (DESIGN.md, docs/design/) and the API contract
(docs/API_MAP.md) are locked. Fixes must work within them. If a fix
seems to need a design or API change, stop and ask me first. Never edit
those files on your own.

## Keeping these docs lean

- Bug details, investigations and before/after notes go in the commit
  message, never in these docs.
- docs/TOUCHPOINTS.md is a map: correct or add rows in place; never
  append notes.
- docs/PITFALLS.md holds at most 15 entries of 3 lines each. When adding
  one would pass 15, merge it with a related entry or remove the least
  useful one, and say which in your report.
- CLAUDE.md stays under 150 lines. Propose changes to it; don't make
  them unless I agree.

## Branches

- New work happens on `redesign/core`. Never merge or push to `main`.
- `archive/legacy-ui` holds the old UI. Never change it.

## Fixing a bug

Work through these steps in order and report each one.

1. **Reproduce.** Find the exact input that shows the bug (for example a file in `data/mock_invoice_dataset/invoices/` and its row in `answer_key/`). Confirm what the API returns for it, so you know whether the fault is in the backend, the API client, or the screens.
2. **Find the root cause.** Name the file and line where the wrong value first appears. Fix it there, not where it shows up.
3. **Trace the impact.** Look up the affected data in `docs/TOUCHPOINTS.md`, then search the code for every other reader of the same field or helper. List every place that could show the wrong value or offer the wrong action. If you find a reader the map is missing, add it to the map.
4. **Fix and protect.** Make the smallest fix at the root. Add a test that fails before the fix and passes after, using the real fixture file.
5. **Verify every touchpoint.** Check each place from step 3, not only the one in the bug report.
6. **Record the lesson, only if there is one.** If the bug came from a pattern that could recur, add one short entry to `docs/PITFALLS.md`. No entry for one-off typos. This is not a changelog.
7. **Report:**
   - the root cause
   - the fix
   - each touchpoint checked, and what it showed before and after
   - the test added
   - anything you noticed but did not change

## Commands

Front end, from the repo root:

- Dev server: `npm run dev` (http://localhost:3000; reads the service at `NEXT_PUBLIC_INVOICE_API`, default `http://127.0.0.1:8000`)
- Build: `npm run build`
- Lint: `npm run lint`
- Types: `npm run typecheck` (runs `next typegen`, then `tsc --noEmit`)
- Tests: `npm test` (Vitest, `src/**/*.test.ts`)

Backend, from `backend/` (settings in `backend/.env`; see `backend/README.md`):

- Install: `uv sync --locked --extra dev --extra docling --extra dummy`
- Run: `uv run uvicorn api.app:app --host 127.0.0.1 --port 8000 --workers 1`
- Check the mode before uploading: `http://127.0.0.1:8000/health`. API docs: `http://127.0.0.1:8000/docs`
- Tests: `uv run pytest -q` (add `--run-docling` for real OCR, `--run-model` for one real model call)
- Lint: `uv run ruff check .` · format: `uv run ruff format --check api check eval extract read dummy schema.py tests`
- Mock dataset through live OCR and checking: `uv run python -m api.evaluate ../data/mock_invoice_dataset`
