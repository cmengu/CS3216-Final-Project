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
"""
