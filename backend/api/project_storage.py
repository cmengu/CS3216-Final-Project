"""Project ownership and currency-separated totals, shared by SQLite and Postgres."""

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

    def list_project_details(self, *, session_id):
        """Bound group-list reads instead of opening two more queries per group."""
        with self.connect() as db:
            projects = db.execute(
                self.project_sql(
                    "SELECT id,name,comparison_mode,created_at FROM {prefix}projects "
                    "WHERE session_id=? ORDER BY created_at,id"
                ),
                (session_id,),
            ).fetchall()
            if not projects:
                return []
            masters = db.execute(
                self.project_sql(
                    "SELECT DISTINCT project_id FROM {prefix}master_lists WHERE session_id=?"
                ),
                (session_id,),
            ).fetchall()
            rows = db.execute(
                self.project_sql(
                    f"SELECT project_id,status,{self._total_fields()} FROM {{prefix}}invoices "
                    "WHERE session_id=? AND status != 'failed'"
                ),
                (session_id,),
            ).fetchall()
        by_project = {}
        for row in rows:
            by_project.setdefault(row["project_id"], []).append(row)
        master_ids = {row["project_id"] for row in masters}
        return [
            {
                **dict(project),
                "has_master_list": project["id"] in master_ids,
                **self._totals(by_project.get(project["id"], [])),
            }
            for project in projects
        ]

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
                    f"SELECT status,{self._total_fields()} FROM {{prefix}}invoices "
                    "WHERE project_id=? AND session_id=? AND status != 'failed'"
                ),
                (project_id, session_id),
            ).fetchall()
        return self._totals(rows)

    def _total_fields(self):
        if hasattr(self, "schema"):
            return "invoice->>'currency' AS currency,invoice->>'invoice_total' AS invoice_total"
        return (
            "json_extract(invoice,'$.currency') AS currency,"
            "json_extract(invoice,'$.invoice_total') AS invoice_total"
        )

    @staticmethod
    def _totals(rows):
        totals = {}
        included = 0
        for row in rows:
            if row["status"] != "completed":
                continue
            currency, amount = row["currency"], row["invoice_total"]
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
