# Security fixes: R02, R03 and R04

Date: 30 October 2026. Status: implemented in the local working tree and running local app; production deployment has not been verified.

| Finding | Change | Verification |
| --- | --- | --- |
| R02: Cross-site request forgery | Cookie-authenticated changes require `X-Requested-With: InvoiceChecker`. Sign-in and sign-out always require it. Requests with an Origin must match the trusted frontend/API origins. All frontend write operations send the header, including multipart uploads. | Missing header, untrusted/null Origin and cross-site multipart requests return 403; trusted requests and CORS preflights pass; cookie-less bearer API clients remain supported. |
| R03: Outlook account-binding gap | OAuth state includes a hash of a random HttpOnly browser cookie and the initiating signed session ID. Callback verifies both before a one-use atomic state consumption and token exchange. PKCE and the 15-minute expiry remain. | Cross-browser and cross-session callbacks, missing nonce, expired and legacy state, replay, and logout during connection are rejected. Correct-browser flow succeeds using a mocked Microsoft provider. |
| R04: Session remains valid after logout | Logout persistently revokes the login session in the invoice database. Cookie, bearer, session-header and query-token access all check revocation. Session verification no longer extends token expiry. Failed logout shows an error with retry and retains local signed-in state. | Old and alternate tokens for the same login return 401 through every transport, including after a SQLite app restart. A new login works. Expiry is preserved. Frontend tests cover network failure, server rejection and successful retry. |

## Checks

- Backend: 276 passed, 9 skipped. Includes 18 new authentication/OAuth security cases and a revocation storage contract tested on SQLite. The Postgres variant is included but was skipped because no test database is configured; other skipped tests require a database or external models.
- Frontend: 135 passed. Checks protected uploads, master preview/import/replacement, invoice decisions, Outlook operations and authentication, plus failed logout behavior.
- Backend Ruff lint/format, frontend ESLint, TypeScript, and production build passed.
- Chrome browser QA passed against an isolated real backend: cookie sign-in, master preview/import, PDF upload, required request headers, failed logout with visible retry, successful logout and HTTP 401 on replay of the old token. No browser page errors.
- All security tests use isolated data; Microsoft exchange/profile responses are mocked. No real mailbox was connected, and no real invoice was changed by testing.

## Configuration and rollout

Database initialization adds `revoked_sessions` to the invoice database and `browser_nonce_hash` to the Outlook state table. Existing invoice data and valid signed sessions are preserved. Keep the persistent database and revocation records across deployments. Old incomplete Outlook connection attempts must be restarted.

The API hostname used to start Outlook login must match the registered callback hostname so both browser cookies arrive on callback. Locally the ignored frontend environment now uses `http://localhost:8001`; open the UI at `http://localhost:3000`, matching the existing Microsoft callback configuration. Production requires correct public callback/frontend URLs and HTTPS. The temporary OAuth cookie uses SameSite=Lax and becomes Secure over HTTPS.

Redeploy the frontend and backend together so new header enforcement and the updated clients arrive together. External cookie-based API clients must send the same header. Existing cookie-less explicit bearer clients do not need it.

## Remaining risks

This resolves the selected findings only. **R01 remains critical:** public default credentials and a predictable fallback signing key can undermine authentication, including creation of fresh session IDs. These changes do not make the app production-ready. The other findings in the original 29-risk report remain open, including account ownership across logins, URL-carried tokens, compatibility-mode authentication, production CORS scope, and frontend offline login behavior.
