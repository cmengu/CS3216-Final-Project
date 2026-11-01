"""Project ownership and currency-separated totals, shared by SQLite and Postgres."""

import json
from decimal import Decimal
from uuid import uuid4


def legacy_project_id(session_id):
    # Deterministic and shared with the SQL migration; session IDs are already bounded.
    return "legacy:" + session_id


class ProjectStore:
    def project_sql(self, sql):
        if hasattr(self, "schema"):
            return sql.replace("{prefix}", self.schema + ".").replace("?", "%s")
        return sql.replace("{prefix}", "")

    def create_project(self, name, mode, *, session_id):
        from .storage import now

        project = dict(
            id=str(uuid4()),
            session_id=session_id,
            name=name,
            comparison_mode=mode,
            created_at=now(),
        )
        with self.connect() as db:
            db.execute(
                self.project_sql(
                    "INSERT INTO {prefix}projects "
                    "(id,session_id,name,comparison_mode,created_at) VALUES (?,?,?,?,?)"
                ),
                tuple(project.values()),
            )
        return {k: v for k, v in project.items() if k != "session_id"}

    def get_project(self, project_id, *, session_id):
        with self.connect() as db:
            row = db.execute(
                self.project_sql(
                    "SELECT id,name,comparison_mode,created_at "
                    "FROM {prefix}projects WHERE id=? AND session_id=?"
                ),
                (project_id, session_id),
            ).fetchone()
        return dict(row) if row else None

    def list_projects(self, *, session_id):
        with self.connect() as db:
            rows = db.execute(
                self.project_sql(
                    "SELECT id,name,comparison_mode,created_at "
                    "FROM {prefix}projects WHERE session_id=? ORDER BY created_at,id"
                ),
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def ensure_legacy_project(self, session_id):
        from .storage import now

        pid = legacy_project_id(session_id)
        with self.connect() as db:
            db.execute(
                self.project_sql(
                    "INSERT INTO {prefix}projects "
                    "(id,session_id,name,comparison_mode,created_at) VALUES (?,?,?,?,?) "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                (pid, session_id, "Existing invoices", "master_list", now()),
            )
        return pid

    def project_totals(self, project_id, *, session_id):
        with self.connect() as db:
            rows = db.execute(
                self.project_sql(
                    "SELECT status,invoice FROM {prefix}invoices "
                    "WHERE project_id=? AND session_id=? AND status != 'failed'"
                ),
                (project_id, session_id),
            ).fetchall()
        totals = {}
        included = 0
        for row in rows:
            invoice = row["invoice"]
            if isinstance(invoice, str):
                invoice = json.loads(invoice)
            if row["status"] != "completed" or not invoice:
                continue
            currency, amount = invoice.get("currency"), invoice.get("invoice_total")
            if not currency or amount is None:
                continue
            totals[currency] = totals.get(currency, Decimal(0)) + Decimal(amount)
            included += 1
        return {
            "invoice_count": len(rows),
            "included_count": included,
            "excluded_count": len(rows) - included,
            "totals": {c: format(v, ".2f") for c, v in sorted(totals.items())},
        }
