# Pitfalls

Short rules learned from real bugs in this repo. Add an entry only when a bug came from a pattern that could happen again. One entry each: the rule, why, and where it bit us. Not a changelog.

<!-- Example shape:
## Never default a missing line status to "match"
A missing or unknown status must show as "Needs you". Defaulting to match makes an unchecked invoice look safe to pay.
Seen: <date>, <file>.
-->

## Check /health for the mode before blaming the code
Shell variables beat `backend/.env` (`os.environ.setdefault`), so a leftover `$env:INVOICE_MODE="fixture"` sends every non-dummy PDF to 422.
Seen: 2026-10-21, `backend/api/app.py` `_load_dotenv`.

## Show the price the service compared, not the printed one
A printed price can be in another currency (USD before the printed rate); `check.lines[].invoice_price` is in the master list's currency.
Seen: 2026-10-21, `src/checker/convert.ts` (F01 freight showed "Invoice 85.00 · Master list 111.35 · Matches").

## Let slow reads finish before polling again
Overlapping polls discard slow responses and multiply invoice/group reads. Read changed results by page, coalesce refreshes and back off after failures.
Seen: 2026-11-06/07, `src/checker/api.ts`, `projects.ts`, `src/lib/read-loop.ts`; initial timeouts also need a retry.

## Commit allowances with accepted work
Deduplicate and reserve every quota/storage allowance in the same transaction as jobs and sources. A later refusal must not consume an earlier allowance.
Seen: 2026-11-07, `backend/api/limits.py`, `jobs.py`, `storage.py`.

## A timeout must release the resource doing the work
Timing out a future does not kill native OCR in its thread. Use a killable subprocess and share a deadline across the invoice's model/check steps.
Seen: 2026-11-07, `backend/read/bounded.py`, `budget.py`, `api/processing.py`.
