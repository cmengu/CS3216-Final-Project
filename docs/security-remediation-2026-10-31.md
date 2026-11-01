# Approved accounts and background invoice batches

Implemented on 31 October 2026. The new branch builds on the archive/XML import and session fixes in PR #48. Production deployment has not been verified.

Previously one configured login minted a new data-owner ID each time, the browser held the remaining archive upload queue, and offline demo credentials could appear to sign in. Accounts are now explicitly approved, each person returns to a stable private workspace, and accepted batches are processed by a durable server queue.

## Approved accounts

- A one-time operator-prepared setup code creates the first administrator. There is no public registration and no default credential fallback.
- Administrators create accounts, set initial credentials, assign Member/Administrator access, disable/enable access and reset another account’s password at `/admin/accounts`.
- Passwords require 15–128 characters and use salted Argon2id. Validation errors omit submitted input, including passwords/setup codes. The UI never retains passwords in browser storage or returns hashes in account lists.
- Every login has a registered server session. Disabling an account, changing its role, or resetting/changing its password invalidates all existing sessions; re-enabling access does not reactivate old tokens.
- Password changes verify the current password and sign out all sessions. An administrator cannot disable/demote their own account through account-management actions, and at least one active administrator is retained.
- Production startup requires an independent secret of at least 32 characters. Authentication cannot be disabled outside automated tests. Legacy signed sessions do not become approved sessions.

The password policy and hashing settings follow [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#implement-proper-password-strength-controls) and [OWASP password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id).

## Private workspaces

Every account owns a separate workspace for invoices and master-list versions, plus its own Outlook connection. Administrative account-management access does not grant cross-account invoice/batch reads. Ownership stays stable across re-login, password changes and disable/enable cycles. OAuth still checks the initiating browser nonce and the exact login session.

Old session-owned files/records are preserved and are not automatically assigned to a new person. `python -m api.manage_accounts recover-workspace --source EXACT_OLD_SESSION_ID --username APPROVED_USERNAME` permits an operator to assign explicitly identified legacy data to an empty approved workspace. It refuses an already approved owner, an occupied target, or unfinished source jobs. Outlook must be reconnected separately. See the [operator setup instructions](../backend/README.md#approved-accounts-and-private-workspaces).

## Background batches

Archives are still unpacked in the browser. The browser submits the complete PDF/XML batch, and the server validates sources, pins the current immutable master version, and persists the original files and queue records before acknowledging HTTP 202. Keep the page open until that acknowledgement. Afterward the browser can close; results remain available after re-login.

The worker runs with the API. Persisted queued jobs survive restart. Expired worker leases can be recovered, with a three-attempt ceiling; stale workers cannot overwrite results. A restart can repeat an OCR/model request, so external-provider calls are not exactly-once. The legacy immediate-upload API is retained. A stopped/autosleeping backend cannot process until it runs again, and deployment storage must persist database/source files.

## Usage and landing page

Persistent, atomic limits bound login attempts, invoice checks, PDF/model checks, master previews, Outlook scans and original-document storage. Responses explain allowance failures and include `Retry-After` for rate limits. Invoice-list refreshes cap concurrent detail reads and reuse unchanged records while background work progresses. Limits are request/source-file allowances, not dollar-denominated provider budgets or a complete database-size cap; configuration defaults are in the [backend documentation](../backend/README.md#background-batches-and-usage-limits).

The landing page now names PDF, Vietnamese HDon XML, ZIP and RAR support and explains background processing after complete upload. The placeholder contact email/form is removed until a real address is supplied.

## Main merge, 1 November 2026

Merged main at `8fa909d`, including project folders, per-project masters and typography/audit updates. Background uploads now retain their selected project, comparison mode and original master version through restart. Duplicate detection is scoped to each project. Totals-only PDF/XML jobs skip price checks. Legacy recovery transfers complete project ownership without bypassing database ownership constraints. Project totals refresh when queued invoices finish.

After the merge, 317 backend tests and 150 frontend tests passed; 13 backend tests require optional Postgres/models and were skipped. Production build, TypeScript, frontend lint and backend lint/format passed. Additional Chrome QA verified creating a project, ZIP upload into that project, processing after closing the entire browser, restored results/counts after fresh sign-in, and desktop/mobile administrator access. Tests used isolated synthetic data. No hosted deployment or production database was changed.

## Email-first administrator creation, 1 November 2026

Normal first-admin setup now uses only the operator-configured administrator inbox, mail delivery
and server signing secret. `AUTH_PASSWORD` and `AUTH_SETUP_TOKEN` are not required. `/setup` first
requests an email code, then verifies it, then displays the username/password form. Email proof
returns an expiring, single-use setup grant; neither requesting nor verifying a code creates an
account or a login session. Only final completion hashes the chosen password and atomically
creates the first administrator and verified email. Concurrent completions cannot create two
initial administrators. The old token/password endpoint is retired (410), so leaked legacy setup
codes cannot reserve the first account. Existing accounts and private data are untouched.

Setup codes expire after five minutes and allow five attempts. Password-creation grants expire
after five minutes, are bound to the configured inbox, and are stored only as hashes. Code HMACs
use a separate setup purpose. Changing the approved inbox invalidates outstanding proof. Sending
has global cooldown/hourly caps and IP/verification limits. Requesting another code does not
invalidate a previously verified owner's unexpired grant; public requests cannot block that
owner from finishing. Initial setup closes when any account exists. The legacy explicit env
bootstrap remains an operator-only option but is not used by this flow.

348 backend tests and 156 frontend tests passed; 15 optional Postgres/model cases were skipped.
Production build, TypeScript, frontend lint and backend lint/format passed. Chrome QA verified
that credentials remain hidden until email proof, no account/session exists before final
completion, incorrect codes fail, and the desktop/mobile flow works. Regression QA covered
approved-account sign-in, resend, private projects and ZIP processing after browser closure.
Emails were captured by an isolated test service; no real email was sent by automated checks.

## Email security codes, 1 November 2026

At the owner's request, the active sign-in flow now uses passwords plus security codes delivered
by Resend to registered email addresses. This supersedes the authenticator implementation below.
The first admin destination is operator-configured; approved members receive an email address
when an administrator creates their account. Neither sign-in nor resend accepts a new recipient.
Existing email changes require the audited operator CLI and invalidate sessions/pending codes.
Password resets preserve the email requirement. Old authenticator sessions, secrets and recovery
codes do not grant access through the new email-proof check.

Codes are cryptographically random, six digits, single-use and expire after five minutes.
Only keyed HMACs are stored; challenge bearer tokens are hashed. Five-attempt limits, persistent
per-account/IP limits, a one-minute resend cooldown and hourly send caps are enforced. Delivery
failure deletes the pending challenge and never issues a login session. Resend invalidates the
old challenge. The backend sends only to the approved address and generates no console/outbox
fallback. The Resend test sender is explicitly restricted to its owner; other users need a
verified sender domain. API keys remain in ignored backend configuration, excluded from Docker.
No provider credentials or real recipient addresses were committed.

335 backend tests and 154 frontend tests passed; 14 optional Postgres/provider cases were
skipped. Production build, TypeScript and frontend/backend lint passed. Chrome verified administrator/member email verification, wrong-code rejection, resend countdown, old-challenge rejection, registered email display, desktop/mobile layouts, private workspaces and background batches after closing the browser, with no page errors. Delivery tests mock the
Resend HTTP API or capture synthetic email in memory. Actual inbox delivery has not yet been
verified; it will be exercised by the owner's administrator setup. Live Supabase remains untested.
Email two-step verification is weaker than an independent authenticator when the inbox is
compromised; phishing-resistant MFA is not provided. See [email setup](../backend/README.md#configure-resend-email-delivery).

## Historical authenticator implementation, 1 November 2026 (superseded)

Every approved account, including the first administrator, now verifies an authenticator app
before receiving any authenticated session. Password/setup responses carry only a five-minute,
single-use challenge. Enrollment offers a locally generated QR and manual key; a correct code
confirms enrollment and returns ten recovery codes once. Users acknowledge saving them before
the UI continues. Secrets are encrypted at rest; recovery codes and challenge bearer tokens are
stored only as hashes. TOTP accepts at most one step of clock skew and rejects consumed counters.
Failed attempts commit, with limits per challenge, account and IP. Stale or password-only sessions
are rejected, as are challenges invalidated by account changes.

Authenticator replacement requires the current password and a fresh factor/recovery code,
then confirmation of the new authenticator. It invalidates other sessions and all old recovery
codes. Password resets preserve MFA. There is no web disable/reset bypass; a privileged,
audited operator CLI is the last-resort reset. Keep the MFA encryption key stable and backed up;
the [backend instructions](../backend/README.md#approved-accounts-and-private-workspaces) explain
the optional separate `AUTH_MFA_KEY` and implications of key rotation.

Validation: 332 backend tests passed, 14 optional Postgres/provider cases skipped; 153 frontend
tests, production build, TypeScript, frontend lint and backend lint/format passed. Dedicated MFA
tests exercise the real mandatory policy; existing password/session regressions mock MFA only
to keep their original assertions focused. Chrome verified administrator/member enrollment,
QR/manual setup, denied password-only access, wrong-code rejection, recovery-code download and
acknowledgement, recovery sign-in, authenticator replacement, revoked old sessions/codes, mobile
layout and a private ZIP batch completing after the entire browser closed. These browser checks
used synthetic identities and fixture invoices with no page errors. Live Supabase and a physical authenticator device
have not been tested. TOTP can still be phished and does not prevent theft of an existing session.

## Original verification, 31 October 2026

- Full backend suite: **304 passed, 12 skipped**. Skips require Postgres or external models. The SQLite/Postgres account, quota and queue contract tests are parametrized; only SQLite was exercised locally.
- Frontend suite: **143 passed**. Lint, TypeScript, backend Ruff lint/format and production build passed.
- Isolated Chrome QA at 1440×1000 and 390×844 verified first-admin setup, account approval/reset/disable/enable, member denial of admin access, private masters/invoices/batch reads, complete ZIP upload and re-login persistence.
- The entire browser process was closed while two fixture invoices were still being read. Both completed on the server without a browser, then appeared after a fresh browser launch/sign-in. No browser page errors occurred.
- Model/Outlook provider behavior uses synthetic fixtures or mocks. No real mailbox, real invoice or administrator password was used in QA. The local app has a private one-time setup link ready; the owner chooses the actual administrator credentials.

R01 (public demo signing/login configuration), R05 (changing owner IDs) and R28 (offline frontend login) are addressed in this implementation. R06 is improved by individual accounts and mandatory email two-step verification; independent/phishing-resistant MFA remains a limitation. R07 is mitigated by persistent quotas/rate limits; strict monetary budgets and other operational controls remain. The remaining audit findings, including dependency advisories, parser isolation, backup/retention and immutable payment audit history, are not resolved by this change.
