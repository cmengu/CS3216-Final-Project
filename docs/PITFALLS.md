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

## Time the next poll from the end of the last one
A timer on a clock starts new reads while old ones run, so a slow service gets more requests the slower it is, and dropped results mean the same reads repeat forever.
Seen: 2026-11-06, `src/checker/api.ts` `useInvoices` (a batch upload took the site down with "signal timed out").
