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
