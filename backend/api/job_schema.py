"""Portable durable invoice queue tables, initialized with the main store."""

JOB_SCHEMA = """
CREATE TABLE IF NOT EXISTS {prefix}invoice_batches (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS {prefix}invoice_jobs (
    invoice_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    status TEXT NOT NULL, master_version TEXT NOT NULL, created_at TEXT NOT NULL,
    owner TEXT, lease_until BIGINT NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS invoice_job_queue ON {prefix}invoice_jobs (status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS invoice_job_workspace_queue ON {prefix}invoice_jobs (workspace_id,status,created_at,invoice_id);
CREATE TABLE IF NOT EXISTS {prefix}fleet_settings (name TEXT PRIMARY KEY,value BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS {prefix}fleet_scheduler (
    id TEXT PRIMARY KEY,ticket BIGINT NOT NULL DEFAULT 0,workspace_id TEXT,
    turn_count INTEGER NOT NULL DEFAULT 0,turn_started BIGINT NOT NULL DEFAULT 0
);
INSERT INTO {prefix}fleet_scheduler (id) VALUES ('main') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS {prefix}fleet_workspaces (workspace_id TEXT PRIMARY KEY,last_turn BIGINT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS fleet_workspace_turn ON {prefix}fleet_workspaces (last_turn,workspace_id);
CREATE TABLE IF NOT EXISTS {prefix}fleet_leases (
    id TEXT PRIMARY KEY,kind TEXT NOT NULL,workspace_id TEXT NOT NULL,owner TEXT NOT NULL,
    lease_until BIGINT NOT NULL,safe_until BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS fleet_lease_capacity ON {prefix}fleet_leases (kind,workspace_id,lease_until,safe_until);
CREATE TABLE IF NOT EXISTS {prefix}fleet_storage (id TEXT PRIMARY KEY,reserved BIGINT NOT NULL);
"""
