# Invoice groups and database migration

Create an invoice group from the Invoices sidebar, then choose one of two modes:

- **Compare with a master list:** upload the project's CSV/Excel master list first. Each invoice keeps the exact master version used for its check. Replacing a project's master does not change old checks or another project's master.
- **Totals only:** upload PDFs or Vietnamese HDon XML immediately. The backend extracts the invoice fields and skips price comparison. The UI labels these invoices **Extracted**, with no match claims or payment decision controls.

The sidebar opens the default project on load (the migrated Existing invoices project when present, otherwise the first-created project), selecting its first invoice when available. Back to invoice groups shows the folder listing; clicking a folder shows only its invoices. The project-list URL preserves that view across refresh and browser navigation. Empty projects show their summary and upload controls. Uploads go to the selected project; selecting an invoice also selects its project. The same PDF can be uploaded to different projects; the browser duplicate check operates within a project.

Outlook is available only inside an open project's invoice sidebar. After downloading attachments (including the AI scan), the **Import Outlook invoices** screen lists PDFs with checkboxes. Users tick the files to import into the project they opened; none are selected initially. The destination is captured when Outlook opens and preserved through OAuth reconnects. No upload occurs until **Import invoices** is clicked. Cancel discards the pending selection. PDFs are held in browser memory until submitted; refreshing discards unsubmitted files.


Projects belong to approved accounts' stable private workspaces. Administrators manage credentials but cannot read another account's projects through the app. ZIP/RAR files are expanded in the browser, then uploaded as complete project-specific background batches. Keep the page open until upload finishes; afterward checking continues while the backend runs. Duplicate detection stays within each project. The selected comparison mode and original master version survive worker restart.

The UI calls these folders **Invoice groups**, with **Group name** and **Group master lists**
labels. Existing API routes, URL parameters and database identifiers retain `projects` and
`project_id` for compatibility; this wording change requires no database migration.

## Database structure

All production tables remain in the `invoice_checker` schema. The local SQLite database gains equivalent project fields.

| Table | Change | Purpose |
| --- | --- | --- |
| `projects` (new) | `id TEXT PRIMARY KEY`, `session_id TEXT NOT NULL`, `name TEXT NOT NULL`, `comparison_mode TEXT NOT NULL`, `created_at TEXT NOT NULL` | A folder with either `master_list` or `totals_only` policy. Names are 1–120 characters. |
| `invoices` | `project_id TEXT NOT NULL`, `comparison_mode TEXT NOT NULL DEFAULT 'master_list'` | Project membership and the processing policy used for this particular upload. |
| `master_lists` | `project_id TEXT NOT NULL` | Each project's immutable master-list version history. |
| Existing invoice JSON/PDF fields | Unchanged | Original PDFs, extraction, check results and decisions remain intact. |

PostgreSQL uses composite foreign keys `(project_id, session_id)` to `projects(id, session_id)` so a row cannot refer to another session's project. Project/session indexes support listing and latest-master queries. SQLite adds project columns without rebuilding the existing tables; insert/update triggers enforce non-null, valid project ownership.

Existing invoices and master versions are assigned to one **Existing invoices** project per existing session, using `legacy:<session_id>`. Existing IDs, source files, decisions and master versions are retained. Running the migration again does not add duplicate projects. Project comparison policy is fixed at creation in this release; no project move/delete or mode-change endpoint is introduced.

Ownership uses this application's approved accounts and stable private workspace IDs, with a separate signed, email-verified session for each login. It is not Supabase Auth user/team ownership. Accounts retain their projects across logins; legacy session-owned projects require explicit operator recovery into the correct approved workspace.

## How the sums work

The backend adds the extracted `invoice_total` of each **completed** invoice in a project using Python `Decimal`. It returns separate totals for each currency; it never adds USD to SGD or converts currencies implicitly. Failed attempts are omitted from project invoice counts and aggregate summaries. In-progress invoices and invoices with no total or currency are excluded from sums and counted visibly. This is the sum of stored completed invoice records, not a deduplicated accounting ledger; an explicit recheck creates another saved record under the existing retry behavior.

Totals-only invoices have `check = null`, an empty `price_sheet_version`, and `comparison_mode = 'totals_only'`. The backend refuses price-check outcomes for these invoices. It still performs OCR/extraction and the existing extraction consistency checks. Missing subtotal/tax handling is unchanged.

## Supabase rollout

The SQL is in [`backend/migrations/001_projects.sql`](../backend/migrations/001_projects.sql). No new environment variables are required; keep the existing backend-only `DATABASE_URL`. Live project uploads use `INVOICE_CHECKER=master_list` (the default) or its `csv_context` alias. The legacy file-backed `standard` checker refuses project uploads rather than comparing against the wrong master.

This repository currently initializes its custom schema through `PostgresStore`, rather than a Supabase CLI migration history. The new initializer also runs this idempotent migration. For an explicit, reviewable production rollout:

1. Back up the database and stop invoice/master uploads during the rollout.
2. Open your Supabase project's **SQL Editor**. Run the contents of `backend/migrations/001_projects.sql` against the existing `invoice_checker` schema.
3. Deploy/restart the updated backend and deploy the updated frontend together. The previous backend does not populate `project_id`, so do not leave old writers running after the migration.
4. Follow the [approved-account setup instructions](../backend/README.md#approved-accounts-and-private-workspaces). Older login sessions no longer authenticate; old data remains under its original owner until an operator explicitly recovers it into an empty approved workspace. Recovery preserves invoice IDs/files and project policies while assigning projects to the approved account. Verify the queries below, then create a totals-only project and a comparison project to check both flows.

If your deployment already uses Supabase CLI-managed migrations, put this SQL in a new timestamped migration and deploy it through that workflow instead of applying an untracked dashboard change. Supabase documents why direct remote edits bypass migration history in its [migration deployment guide](https://supabase.com/docs/guides/deployment/database-migrations).

The API accesses PostgreSQL directly. Do not expose this custom schema through the browser/Data API to make this feature work; the API's signed-session ownership checks remain authoritative.

Verification queries (read-only):

```sql
SELECT id, name, comparison_mode FROM invoice_checker.projects;

SELECT COUNT(*) AS unassigned_invoices
FROM invoice_checker.invoices WHERE project_id IS NULL;

SELECT COUNT(*) AS unassigned_master_versions
FROM invoice_checker.master_lists WHERE project_id IS NULL;

SELECT p.name, i.comparison_mode, COUNT(*) AS invoices
FROM invoice_checker.invoices i
JOIN invoice_checker.projects p ON p.id = i.project_id AND p.session_id = i.session_id
GROUP BY p.name, i.comparison_mode;
```

Both unassigned counts should be zero. No Supabase-hosted database has been changed as part of implementation/testing.

For local SQLite, restarting the backend migrates the existing database automatically. The file location is still `INVOICE_DATA_DIR/invoices.sqlite3`; do not delete it to apply the migration.

## API and code map

| Call | Behavior |
| --- | --- |
| `POST /projects` | JSON `{ "name": "Travel", "comparison_mode": "totals_only" }` creates a project. |
| `GET /projects` | Current session's projects, master readiness, counts and currency totals. |
| `GET /projects/{id}` | One project's details and aggregate. |
| `POST /invoices?project_id={id}` | PDF multipart upload; extract only or compare with that project's latest master snapshot. |
| `GET /invoices?project_id={id}` | Paginated invoice summaries for a project; omit the query to list all session invoices. |
| `GET/POST/PUT /master-list?project_id={id}` | Read/upload/replace a project's master. A totals-only project rejects master uploads. |
| `GET /master-list/versions/{version}?project_id={id}` | Project-scoped historical version. |
| `GET /master-list/events?project_id={id}` | Project-scoped master upload/replacement history. |

For compatibility, old upload/master clients omitting `project_id` use the session's legacy project. The new UI always sends a project ID. An invalid or other-session ID returns 404, never falls back to another project's master.

- `backend/api/projects.py`: project API and ownership checks.
- `backend/api/project_storage.py`: shared project persistence and decimal aggregation.
- `backend/api/storage.py`: SQLite/Postgres migration and project-aware invoice/master queries.
- `backend/api/app.py`, `uploaded_master.py`, `master_list.py`: upload policy, extraction and master snapshot selection.
- `src/components/invoices/Queue.tsx`: folder sidebar.
- `src/app/(app)/invoices/page.tsx`: project overview and upload destination.
- `src/components/invoices/ProjectAssignment.tsx`: Outlook per-file destination screen.
- `src/components/invoices/OutlookDialog.tsx`: download first, then hand files to assignment.
- `src/checker/uploads.ts`: project-aware queue, retries and duplicate detection.
