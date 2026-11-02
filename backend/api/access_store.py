"""Small SQL adapter for access controls stored alongside the invoice database."""

import re
from contextlib import contextmanager


class AccessStore:
    def __init__(self, store):
        self.store = store
        schema = getattr(store, "schema", None)
        if schema is not None and not re.fullmatch(r"[a-z_][a-z0-9_]*", schema):
            raise ValueError("Invalid access-control database schema")
        self.schema = schema

    def table(self, name):
        if not re.fullmatch(r"[a-z_]+", name):
            raise ValueError("Invalid access-control table")
        return f"{self.schema}.{name}" if self.schema else name

    def execute(self, db, query, params=()):
        return db.execute(query.replace("?", "%s") if self.schema else query, params)

    @contextmanager
    def connect(self):
        with self.store.connect() as db:
            yield db
