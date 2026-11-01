-- Idempotent migration. Run in Supabase SQL Editor before deploying the project-aware API.
BEGIN;
CREATE TABLE IF NOT EXISTS invoice_checker.projects (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    comparison_mode TEXT NOT NULL CHECK (comparison_mode IN ('master_list', 'totals_only')),
    created_at TEXT NOT NULL,
    UNIQUE (id, session_id)
);
ALTER TABLE invoice_checker.invoices ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE invoice_checker.invoices ADD COLUMN IF NOT EXISTS comparison_mode TEXT NOT NULL DEFAULT 'master_list';
ALTER TABLE invoice_checker.master_lists ADD COLUMN IF NOT EXISTS project_id TEXT;
INSERT INTO invoice_checker.projects (id,session_id,name,comparison_mode,created_at)
SELECT 'legacy:' || session_id, session_id, 'Existing invoices', 'master_list', MIN(created_at)
FROM (
    SELECT session_id,created_at FROM invoice_checker.invoices WHERE project_id IS NULL
    UNION ALL
    SELECT session_id,created_at FROM invoice_checker.master_lists WHERE project_id IS NULL
) legacy GROUP BY session_id ON CONFLICT (id) DO NOTHING;
UPDATE invoice_checker.invoices SET project_id='legacy:' || session_id WHERE project_id IS NULL;
UPDATE invoice_checker.master_lists SET project_id='legacy:' || session_id WHERE project_id IS NULL;
ALTER TABLE invoice_checker.invoices ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE invoice_checker.master_lists ALTER COLUMN project_id SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_project_owner_fk' AND conrelid='invoice_checker.invoices'::regclass) THEN
        ALTER TABLE invoice_checker.invoices ADD CONSTRAINT invoices_project_owner_fk
        FOREIGN KEY (project_id,session_id) REFERENCES invoice_checker.projects(id,session_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='master_lists_project_owner_fk' AND conrelid='invoice_checker.master_lists'::regclass) THEN
        ALTER TABLE invoice_checker.master_lists ADD CONSTRAINT master_lists_project_owner_fk
        FOREIGN KEY (project_id,session_id) REFERENCES invoice_checker.projects(id,session_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS projects_session_idx ON invoice_checker.projects(session_id,created_at);
CREATE INDEX IF NOT EXISTS invoices_project_idx ON invoice_checker.invoices(session_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS master_lists_project_idx ON invoice_checker.master_lists(session_id,project_id,seq DESC);
COMMIT;
