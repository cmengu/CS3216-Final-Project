# Invoice Checker — Duc's backend

Built for the 10 October build plan: upload → Docling → extraction adapter → checking adapter
→ SQLite. Completed records and original PDFs survive a restart. The existing Next.js PO demo
is unchanged; Nam can build the new screens against this API.

**Modes:** `live` reads PDFs with Docling and extracts printed fields using OpenAI. Vietnamese HDon XML invoices map structured fields directly, bypassing OCR and model extraction; the same master-list checks, review rules and persistence apply. Missing fields remain unknown. XML DTDs/entities and unsupported XML formats are rejected.
The default `INVOICE_CHECKER=master_list` uses the versioned, uploaded master list.
`csv_context` remains an alias for this mode. The explicit `standard` mode retains the legacy
file-backed checker and requires `INVOICE_PRICE_SHEET`. `fixture` replays answers for the exact original
dummy PDFs and refuses other hashes. Never use fixture mode to measure AI accuracy.

## Live setup and local environment template

Create `backend/.env` using this template. `.env*` is ignored by Git, including this file.
Keep credentials in this backend file, never in `NEXT_PUBLIC_*` or frontend code.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=none
INVOICE_MODE=live
INVOICE_CHECKER=master_list
INVOICE_DATA_DIR=runtime/live
INVOICE_OCR_TIMEOUT=180
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:8001/auth/outlook/callback
```

Fill the key locally. `gpt-6-luna` with reasoning `none` prioritizes latency; availability
depends on the API project. See the [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).
Remove `OPENAI_REASONING_EFFORT` when selecting a model without reasoning support.
Paths above are relative to `backend/`. Before starting the API, prepare the first admin
with `python -m api.manage_accounts prepare-setup` as described below. From that directory:

```sh
uv sync --locked --extra dev --extra docling --extra dummy
.venv/bin/python -m uvicorn api.app:app --env-file .env --host 127.0.0.1 --port 8001 --workers 1
```

Live startup fails clearly if the key or model is missing. Create a project first. Comparison
projects require their own master list (409 until uploaded); totals-only projects extract invoices
without a master. See [projects and Supabase migration](../docs/projects-and-supabase.md). Restart after editing
`.env`. Provider access/quota errors can still occur on the first extraction. Extraction
uses `store=False` and may make a correction request after its initial model request.

For an Ollama primary with a private Cloud Run backup, configure the backend environment:

```ini
OLLAMA_BASE_URL=http://100.89.215.68:11434
OPENAI_MODEL=gemma4:e4b
OLLAMA_CHALLENGER_MODEL=qwen3.5:4b
OLLAMA_FALLBACK_BASE_URL=https://linecheck-gemma-backup-387784514551.asia-southeast1.run.app
OLLAMA_FALLBACK_MODEL=gemma4:e4b
GOOGLE_APPLICATION_CREDENTIALS=/path/to/private/cloud-run-caller.json
OLLAMA_STARTUP_TIMEOUT_SECONDS=600
OLLAMA_REQUEST_TIMEOUT_SECONDS=120
```

The credential belongs on the backend host, outside source control, with Cloud Run Invoker
on the backup service. A Google-hosted backend can instead use its attached service identity.
On Railway, add a private `GOOGLE_SERVICE_ACCOUNT_JSON` variable containing the complete
downloaded service-account JSON. This variable takes precedence over the credential-file
path and avoids requiring a local file on Railway. Never use a `NEXT_PUBLIC_` variable for it.
An unreachable primary is briefly bypassed while the backup handles requests. The Qwen
challenger keeps its own model name; `OLLAMA_FALLBACK_CHALLENGER_MODEL` can override it.

The primary URL must be reachable from the Railway container. The `100.89.215.68` address
is private to the Tailscale network; Railway needs a connection to that network to use it.
Otherwise, the configured backup handles the model requests after the primary fails.
On Vercel set `NEXT_PUBLIC_INVOICE_API=/api`; the existing rewrite forwards API calls to
Railway. The model URLs, credentials and timeout variables belong to the Railway backend.

Before sending invoice text to Cloud Run, the transport sends an empty model-load request.
It allows up to 600 seconds for startup, including transient service errors and a model
that is still downloading. Once loading succeeds, inference gets its separate 120-second
budget. These limits are configurable positive seconds. Permanent authentication/permission
errors fail immediately. An unavailable backup eventually fails with a startup-specific error.
Queued invoices stay in extraction while waiting, and their worker renews the job lease.

Set the Cloud Run service's request timeout to 900 seconds so the platform allows the model
load to finish. The transport also retries a platform 504 during loading within the original
startup deadline. Increasing the client timeout alone does not change Cloud Run's timeout.
Interactive master-list suggestions share a shorter 45-second budget across primary and
challenger calls. If a model is still starting, preview returns editable manual mappings
within the browser's 60-second preview limit. The longer startup allowance applies to
background invoice processing.

Map arbitrary spreadsheet headings to the import fields described below. Name and unit price
are required; currency, unit and quantity constrain the comparison when mapped. Without a
master currency, the agreed price is interpreted in the invoice unit-price currency.
Supplier, PO and validity dates constrain the
agreement when mapped; otherwise the row is unscoped. Discount and tax terms are checked
when present. Numeric SKUs are supported. Ambiguous agreements require review. Code-free charges
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
INVOICE_MODE=fixture .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8001 --workers 1
```

For the real steps, with the key and model in the environment:

```sh
INVOICE_MODE=live INVOICE_CHECKER=master_list \
  .venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8001 --workers 1
```

Upload the master list through the frontend, review its column mappings, then confirm the
import. Each invoice captures the current immutable master version before OCR starts.
Replacing the master affects subsequent uploads immediately, without a server restart.
Old invoices retain their saved results; use Recheck with current master list to create a
new check explicitly. `GET /master-list/versions/{version}` retrieves the original snapshot.

Open <http://127.0.0.1:8001/docs> to upload a PDF through Swagger, or from the repository root:

```sh
curl -F 'file=@data/dummy/invoice-02.pdf' http://127.0.0.1:8001/invoices
curl http://127.0.0.1:8001/invoices
```

The first Docling run downloads model weights. Subsequent runs reuse locally cached weights
and converter instances. The reader is configured for CPU execution. No API key is needed for
fixture mode. With no `INVOICE_MODE`, uploads return 503. Any other value stops the start.

This service requires sign-in by default. Keep the loopback binding and a single worker for local use.
Only one invoice processes at a time; concurrent uploads receive 429 and Retry-After. The
legacy `POST /invoices` request waits for processing to finish. The app uploads complete batches
to `POST /invoice-batches`, which accepts them before processing. Keep the backend running and
its database/files persistent so work continues after the browser closes or the service restarts.

## Browser authentication and request protection

Sign-in is required by default. `POST /auth/sign-in` and `POST /auth/sign-out`
require `X-Requested-With: InvoiceChecker`, including requests without a session cookie.
Every other state-changing request carrying `ic_session` also requires that header.
When an `Origin` is present, it must match the configured frontend/CORS allowlist or the
API’s own origin. This includes multipart master-list and invoice uploads. The frontend
adds the header automatically; nonbrowser clients using only explicit bearer credentials
can continue without it. CORS permission alone does not authorize a cookie-authenticated
mutation. Keep allowed origins restricted to trusted frontends.

Logout records the login session in the invoice database’s `revoked_sessions` table.
All credential transports also require a registered account session and an active approved
account. Disabling an account, changing its role, or resetting its password invalidates its
existing sessions. Revocation survives service restarts, and
`GET /auth/me` preserves the existing token expiry. Keep the persistent database through
redeploys; removing the revocation records can reactivate old, unexpired tokens.
If logout cannot reach the server, the UI reports the failure and lets the user retry.

Outlook starts a 15-minute, one-use flow with PKCE, a hashed browser nonce and the app’s
signed session ID. Its temporary `ic_outlook_oauth` cookie is HttpOnly, SameSite=Lax and
Secure over HTTPS. The callback validates both browser and app session before exchanging
a code. Restart any Outlook connection flow started before this migration.

Use the same public API hostname for login and the registered Microsoft callback so the
browser sends both cookies. For the default local callback, set
`NEXT_PUBLIC_INVOICE_API=http://localhost:8001` and use `http://localhost:3000` for the UI;
avoid mixing `localhost` with `127.0.0.1`. Production must use HTTPS, correct callback and
frontend URLs, and a persistent invoice database. Approved accounts and an independent signing secret are required; the public demo login
and frontend offline login fallback have been removed.

## Approved accounts and private workspaces

There is no open registration. At `/admin/accounts`, an administrator approves only an email
address and the app emails a personal invitation link. The link opens `/join`, verifies the
approved inbox, then lets the person choose their own username and password. The link expires
in 24 hours and can be used once. Approval creates
no account or workspace until that final step. New accounts are Members; an administrator can
change their access afterwards. Delivery success/failure is shown with pending approvals; failed or expired invitations can be resent.
Pending approvals are listed separately and can be revoked,
which invalidates pending codes and verified setup grants, even if the email is approved again.
Administrators can still enable/disable accounts, change roles and reset existing passwords.
Each account owns a separate, stable private workspace for invoices, master versions and its
Outlook connection. Administrative access manages credentials; it does not grant read access
to another account’s invoices or batches. Any account can change its own password at `/account`.
Passwords require 15–128 characters and use salted Argon2id (19 MiB, two passes, one lane); plaintext passwords are not stored.

Users who forget a password can open `/forgot-password` from the sign-in page. They enter
their registered email, verify a six-digit code and choose a new password. Unknown, pending
or disabled addresses receive the same start response without sending a code or creating an
account. Recovery never changes the registered inbox, role, approval or workspace.
Successful reset invalidates all existing sessions and pending login/reset challenges. The
user then signs in normally with the new password and a fresh email code; reset does not
automatically sign in. Accounts without a registered inbox need operator assistance.

Reset codes and verified reset grants expire after five minutes and are single-use. Account,
password, access or registered-email changes invalidate outstanding reset proof. Code requests
have a 60-second cooldown, ten sends per inbox per hour and IP limits; verification allows
five attempts with an additional per-account limit. Recovery grants are stored only as hashes,
and code HMACs use a purpose separate from sign-in and initial account setup. All reset
mutations require the browser protection header, including before sign-in.

Every approved account can sign in with its username or registered email, plus its password
and a six-digit code sent to its registered
email address. The first administrator's destination is configured by the operator using
`AUTH_ADMIN_EMAIL`; the setup form cannot choose a different destination. Administrators
approve an email before each new account can be created. Email ownership is verified before
the username/password form appears. The public endpoint cannot choose a role or workspace. Password resets preserve the registered email. Existing password-only or
old authenticator sessions no longer authenticate; existing data and accepted jobs are retained.

Codes expire after five minutes and are single-use, with five failed attempts per challenge,
a 60-second send cooldown, a ten-email hourly account cap and per-account/IP verification
limits. Resending invalidates the earlier challenge. Only hashes of challenge tokens and
server-keyed HMACs of codes are stored. Codes are never returned by the API or written to logs.
Email delivery failures leave the user signed out; no code logging or alternate-recipient
fallback is available. This is email two-step verification, not phishing-resistant MFA; inbox
compromise can defeat it. The authenticator/QR/recovery-code flow is no longer used.

### Sending service and recipient email addresses

A delivery service (AgentMail, Resend or Brevo) sends the invitation links and security codes. Gmail, Outlook and other addresses are
recipients and need no provider-specific app registration or mailbox password. The application
does not connect a Gmail mailbox to send email.

The `onboarding@resend.dev` test sender can deliver only to the address registered to the
Resend account. This is a recipient-address restriction, not a restriction on Gmail versus
Outlook. To invite arbitrary approved addresses, verify a sender domain once in Resend and
use an address on that domain for `AUTH_EMAIL_FROM`. The recipients do not verify domains.
Pending invitations remain approved and can be retried after sender configuration is ready.

### Configure AgentMail with a dedicated sender

AgentMail provides its own `@agentmail.to` sender address, so a custom domain or connection
to a personal Gmail/Outlook mailbox is not required. In the [AgentMail console](https://console.agentmail.to),
create a dedicated inbox for Invoice Checker. Even a sending-only integration needs the inbox
ID because it identifies the From address. Prefer an inbox-scoped API key whose explicit
permissions enable only `message_send`; the app does not require inbox/message reading,
account management, or other sender inboxes.

Save these private backend variables in ignored `backend/.env.email` or the hosting service:

```dotenv
AUTH_EMAIL_PROVIDER=agentmail
AGENTMAIL_API_KEY=your_private_send_only_key
AGENTMAIL_INBOX_ID=your_dedicated_inbox_id
AUTH_ADMIN_EMAIL=owner@example.com
```

Restart the backend after updating settings. Account verification, new-recipient restrictions,
sending allowance and delivery policies still apply; API acceptance does not guarantee inbox
placement. The app calls only the fixed HTTPS send endpoint, preserves the approved recipient,
uses an idempotency key, disables redirects and never silently falls back to another provider.
Do not put keys into frontend settings, chat, screenshots or Git. Shared-domain sender reputation
and processing of message contents remain dependencies on AgentMail.

Provider instructions: [quickstart](https://www.agentmail.to/docs/quickstart),
[send API](https://docs.agentmail.to/api-reference/inboxes/messages/send),
[key permissions](https://docs.agentmail.to/permissions), and
[new-account limits](https://www.agentmail.to/docs/knowledge-base/agent-sign-up-limits).

### Try Brevo with an email-verified sender

For an initial test without a custom domain, Brevo can verify a sender email address. When
sending from a free-email address such as Gmail, Brevo can temporarily substitute its own
sending domain, including for transactional messages. This is a testing/transition option;
Brevo recommends an authenticated sender domain for reliable long-term delivery. Account
validation, sending limits and provider deliverability policies still apply.

1. Create a [Brevo account](https://app.brevo.com/account/register).
2. In **Settings > Senders, Domains, IPs > Senders**, add a sender named **Invoice Checker**
   and an email you own. Enter the verification code Brevo sends to that inbox. This verifies
   the sender identity; it does not connect or grant access to that mailbox.
3. Under **Settings > SMTP & API > API keys**, generate an API key named **Invoice Checker**.
   Use the API key beginning with `xkeysib-`, rather than an SMTP key or mailbox password.
4. Keep the key and verified sender in private backend settings:

```dotenv
AUTH_EMAIL_PROVIDER=brevo
BREVO_EMAIL_FROM=your_verified_sender@gmail.com
BREVO_API_KEY=your_private_brevo_api_key
```

Keep the current provider selected until the Brevo account, sender and API key are ready.
Restart the backend after switching. Retained Resend settings are not used while Brevo is
selected; failures do not silently fall back or rewrite the approved recipient. Hosted backend
settings use the same variables. Private environment files remain excluded from Git/Docker.
The app sends inline invitation/code content through the fixed HTTPS transactional API,
`https://api.brevo.com/v3/smtp/email`, without synchronizing contacts or reading any inbox.
An API acceptance is not a guarantee of inbox placement; inspect Brevo delivery logs if a
message is delayed, blocked or rejected. Protect the API key as access to the Brevo account.

Provider instructions: [sender email verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email),
[free-email sender replacement](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders),
and [API key setup](https://developers.brevo.com/reference/quickstart-reference).

### Configure Resend email delivery

1. Create a Resend account. For testing with `onboarding@resend.dev`, use the same account email
   as the administrator's inbox. Resend restricts this sender to its owner's address.
2. Create a **Sending access** API key at <https://resend.com/api-keys>.
3. Keep the key in the backend only. Local settings can be split between ignored `backend/.env`
   and `backend/.env.email`; process environment variables take precedence. Set:

```dotenv
RESEND_API_KEY=your_private_sending_key
AUTH_ADMIN_EMAIL=owner@example.com
AUTH_EMAIL_FROM=onboarding@resend.dev
AUTH_EMAIL_TEST_RECIPIENT=owner@example.com
```

4. Restart the backend and open `/setup`. Request a code sent only to `AUTH_ADMIN_EMAIL`,
   verify the code, then choose the administrator username and password. No account is created
   or reserved before email verification. No `AUTH_PASSWORD` or `AUTH_SETUP_TOKEN` is required.
5. To serve other approved users, verify a domain you own in Resend and change `AUTH_EMAIL_FROM`
   to an address on that domain, such as `security@your-company.example`. The test sender is
   deliberately blocked from sending another user's codes to the test owner. Do not try to
   verify `outlook.com` or another provider's domain. Set these same private variables on the
   hosted backend when deploying; local files are excluded from Git and Docker.

Provider instructions: [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction),
[test sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
and [sending domains](https://resend.com/docs/dashboard/domains/introduction).

Email changes for existing accounts require an operator who has independently verified the
owner. Users cannot choose or replace a security email through sign-in or an account mutation:

```sh
.venv/bin/python -m api.manage_accounts set-email --username APPROVED_USERNAME --email owner@example.com
```

This audited action invalidates sessions and pending codes, then requires a code sent to the
new approved address. Private invoices and projects retain their owner. A new Supabase database
initializes `account_email`, `email_challenges`, and `email_login_sessions` automatically in
the private schema. Older accounts without a registered email need this explicit operator step.
Old authenticator tables may remain as inactive legacy data; they grant no login access.
This version uses a new email-session proof table, so previous email-only and authenticator
sessions must sign in again; historical proof cannot bypass the current email-code check.

Configure `AUTH_SECRET` as an independent random secret of at least 32 characters and configure
`AUTH_ADMIN_EMAIL` plus the selected delivery provider. Administrator setup is email-first: the configured inbox
receives a five-minute code; verifying it grants five minutes to choose credentials. The grant
is single-use, bound to the configured email and stored only as a hash. Account creation and
proof consumption happen atomically, so concurrent requests cannot create two initial admins.
Further code requests cannot invalidate an already verified, unexpired password-creation grant.
Once any approved account exists, all initial-setup endpoints refuse additional creation.

The public `/setup` page does not accept a caller-selected inbox. First-account setup requires
neither an environment password nor a private link token. Failed delivery, wrong codes and
abandoned verification do not reserve the administrator account. Setup has persistent global
send cooldown/hourly caps plus IP and verification limits to bound mail abuse and guessing.
The old `POST /auth/setup` token/password endpoint returns 410 and cannot create an account.

Optionally prepare server secrets and a convenient local setup shortcut from `backend/`:

```sh
.venv/bin/python -m api.manage_accounts prepare-setup
```

This writes private secrets to ignored `.env` and a clean `/setup` shortcut to the configured
data directory. It does not store an administrator password or generate a setup token. Normal
onboarding only needs `AUTH_SECRET`, the approved email and the email-delivery settings.
Existing explicit non-default `AUTH_USERNAME`/`AUTH_PASSWORD` bootstrap settings remain a legacy
operator-only alternative; they are not required and never become a continuing login fallback.
Existing accounts are retained. Authentication cannot be disabled outside automated tests.

Old session-owned data is preserved but is never automatically assigned to a new person. An
operator who knows the owner can explicitly recover one old workspace into an empty private
account; Outlook must be reconnected separately:

```sh
.venv/bin/python -m api.manage_accounts recover-workspace --source EXACT_OLD_SESSION_ID --username APPROVED_USERNAME
```

This refuses to reassign another approved account’s workspace, move unfinished jobs, or merge
over an existing target workspace. Keep a database/files backup before an operator recovery.

## Background batches and usage limits

`POST /invoice-batches` accepts multipart `files` (1–1,000 PDF/XML files, at most 20 MiB each
and 100 MiB together). ZIP/RAR extraction stays in the browser. Keep the browser open while
unpacking/uploading. Only after HTTP 202 does the UI promise that checking continues without
the browser. A malformed batch is rejected before any invoices/jobs are committed. Exact
file duplicates are skipped. Results appear under the same approved account after re-login.
`GET /invoice-batches/{id}` returns private queued/processing/completed/failed counts.

An optional `project_id` query selects an owned project. Duplicate detection is scoped to
that project. The queue pins the project's comparison mode and master version; totals-only
projects extract fields without a master list or price check. Project counts/totals refresh
as queued invoices finish. Omitting the project retains the legacy Existing invoices folder.

Jobs and original sources are persisted before acceptance. Every job pins the uploaded
master version. A worker starts with the API, processes one job at a time through the same
conservative checker, renews a lease and rejects writes from an expired worker. Queued jobs
survive restart; expired in-progress leases are retried, up to three attempts. PDF/OCR/model
calls may repeat after a crash; completion is not an exactly-once external-provider guarantee.
Use an always-running backend and persistent SQLite storage, or Postgres for durable source
blobs and queue records. An autosleeping or stopped service cannot process until it resumes.
Outlook’s token store still needs persistent local storage.

Limits are persistent across service restarts and atomic across workers:

| Setting | Default per private workspace |
| --- | --- |
| `INVOICE_CHECKS_PER_HOUR` | 1,000 invoices |
| `INVOICE_CHECKS_PER_DAY` | 2,000 invoices |
| `INVOICE_AI_CHECKS_PER_DAY` | 200 PDF checks |
| `INVOICE_PREVIEWS_PER_HOUR` | 30 master-list previews |
| `INVOICE_MAIL_SCANS_PER_HOUR` | 12 Outlook scans |
| `INVOICE_STORAGE_LIMIT_MB` | 1,024 MiB of original invoices/master files |

Use positive whole numbers. Allowance windows start with the first request; daily means 24 hours. Login is limited to 20 attempts/IP/10 minutes and eight attempts
per username/IP/10 minutes. Administrator account changes and password changes are also
limited. HTTP 429 carries `Retry-After`. These are request/source-storage allowances, not
currency-denominated AI budgets or a cap on database/parsed-document overhead. Provider budgets,
backups, parser isolation and the remaining security-report findings still need production review.

## HTTP contract for Nam

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | Active mode and whether processing is configured |
| POST | `/invoices` | Legacy immediate multipart `file`; 201 with saved result |
| POST | `/invoice-batches` | Multipart `files`; 202 with persisted queued invoices and duplicates |
| GET | `/invoice-batches/{id}` | Private batch progress |
| GET | `/invoices?limit=50&offset=0` | Newest-first summaries; limit 1–100 |
| GET | `/invoices/{id}` | Saved full record including read output, fields and results |
| GET | `/invoices/{id}/file` | Original PDF (inline) or XML (download) |
| PUT | `/invoices/{id}/outcome` | JSON `{"outcome", "reason"}`; saves or clears the clerk's decision (proposed) |

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

Outcomes (proposed, not yet agreed): `ready_to_pay`, `ready_to_pay_anyway`,
`raise_with_supplier`, or `null` to clear one. Every record carries `outcome`,
`outcome_reason` and `decided_at` (the service's clock). `ready_to_pay` is accepted only on a
completed invoice with a non-null `overcharge_total` and every line a `match`;
`raise_with_supplier` only when a line is a `price_mismatch` with a positive difference;
`ready_to_pay_anyway` on any finished invoice, failed ones included, with a reason of 1–500
characters. An invoice still being checked answers 409, a missing reason 422.

CORS allows localhost/127.0.0.1 on port 3000, the comma-separated origins in
`INVOICE_ALLOWED_ORIGINS`, and any origin that fully matches `INVOICE_ALLOWED_ORIGIN_REGEX`
(for preview deployments, whose address changes each time). HTTP errors use `detail`; processing failures
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

## XML invoice uploads

`POST /invoices` also accepts `.xml` files up to 20 MiB in live mode. Supported vocabulary: Vietnamese `HDon/DLHDon`, with invoice header, seller, lines, discounts and totals. This does not verify the issuer’s digital signature. Missing totals/currency, special lines and unsupported tax/discount terms require human review; no missing values are inferred. The original bytes and filename are retained. ZIP/RAR files are unpacked by the frontend worker; the API receives the complete extracted PDF/XML batch before acknowledging background processing.

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

## Legacy standard checker's rules

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


### Master-list import

The redesigned `/master-list` page now uses persisted backend data. Upload CSV,
XLSX or XLS (up to 5 MiB), select the worksheet/header row and confirm column mappings.
Header rows and column mappings are suggested by the configured OpenAI model using headings and sample rows, including unfamiliar languages and labels. Required fields are `name` and `price` (unit price). Quantity can be omitted with
“None”; it is stored as null and `totalPrice` equals `price`. When quantity
is supplied, `totalPrice` is price × quantity before discount. Other absent fields default to JSON null. No values
are generated by a model and no sample rows are substituted for Excel files.

- `POST /master-list/preview`: multipart `file`; returns worksheets, up to 50 source
  rows per sheet, suggested zero-based header/column indices, and supported fields.
- `POST /master-list`: initial upload, multipart `file` plus optional JSON `options`
  containing `sheet`, `header`, `mapping`. Returns 201 with the normalized list.
- `PUT /master-list`: validated replacement, returning the normalized list.
- `GET /master-list`: latest persisted list or null before initial upload.
- `GET /master-list/events`: upload/replacement history, newest first.

Prices and quantities are non-negative decimal strings; zero is valid. Formula
cells in required fields must be replaced with values. Missing required values or
invalid numbers reject the entire import with a row-specific error. Use decimal
points; ambiguous comma decimal formats are rejected. Optional discount accepts a
fraction or explicit percent; optional dates use YYYY-MM-DD. Only the selected
worksheet is imported. Limits: 20 worksheets, 100 columns, 10,000 data rows, 50 MiB
expanded XLSX content. The original upload and normalized snapshots are stored in
SQLite alongside invoice data. Rejected imports leave the current list intact.

The live invoice checker uses these confirmed imports. Each check stores the selected
master version, and historical versions remain readable after replacements. Optional
supplier, PO, unit, currency, discount, tax and date constraints apply when populated.
A mapped master quantity must equal the invoice quantity; null skips that constraint.
It does not supply missing product quantities. Prices can be compared in the printed
unit-price currency or converted to the mapped invoice currency using an explicit printed
exchange rate. Ambiguous rows and inconsistent arithmetic require review.
Discount and tax rates are stored as decimal strings. Authentication remains the existing
frontend stub; these local API routes do not enforce per-user ownership.


AI mapping uses `OPENAI_API_KEY`, `OPENAI_MODEL` and `OPENAI_REASONING_EFFORT` from
backend configuration. The Responses API receives the first 50 rows of each
non-empty worksheet (cells capped at 200 characters, total payload 150,000
characters), with `store=false`, a 45-second timeout and no automatic retries.
Only header and column indices are returned, using a structured schema; they are
validated against the source dimensions before use. Unknown/ambiguous mappings
are left unset for user review. On failure, refusal, invalid output or missing
configuration, preview returns editable manual mappings and a visible message.
Confirmed imports use the submitted mapping without a second model call. Models
never supply imported cell values. Complex layouts, headers after row 50, and
multiple independent tables on one sheet still require manual cleanup/selection.
