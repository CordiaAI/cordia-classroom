"""A small in-memory stand-in for the supabase-py query builder, for route tests."""
import copy
import uuid
from types import SimpleNamespace

DEFAULTS = {
    "schools": {"email_domains": []},
    "classes": {"display_name": "", "sharing_blocked": False},
    "shared_sets": {"version": 1, "status": "visible", "visibility": "private", "card_count": 0},
    "shared_set_reports": {"status": "open"},
    "canvas_connections": {"status": "connected", "sync_paused": False},
    "canvas_courses": {"imported": False, "topic_summary": ""},
    "class_merge_proposals": {"status": "pending"},
    "copyright_takedowns": {"status": "received"},
}
ID_TABLES = {"schools", "classes", "class_terms", "folders", "study_guides", "shared_sets", "shared_set_reports",
             "class_merge_proposals", "copyright_takedowns", "instructor_blocks", "canvas_activity"}


class FakeDB:
    def __init__(self):
        self.tables = {}
        self.auth = SimpleNamespace(admin=SimpleNamespace(get_user_by_id=self._no_user))
        self._clock = 0

    def _no_user(self, _user_id):
        raise LookupError("no auth in tests")

    def rows(self, name):
        return self.tables.setdefault(name, [])

    def table(self, name):
        return Query(self, name)


class Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload = [], "select", None
        self._order, self._limit, self.on_conflict, self.columns = None, None, None, None

    # filters
    def select(self, columns="*", **_kwargs):
        self.op = "select"
        self.columns = None if columns.strip() == "*" else [c.strip() for c in columns.split(",")]
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: r.get(key) == value)
        return self

    def in_(self, key, values):
        values = list(values)
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) < str(value))
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) >= str(value))
        return self

    def lte(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) <= str(value))
        return self

    def ilike(self, key, pattern):
        needle = pattern.strip("%").lower()
        starts = not pattern.startswith("%")
        self.filters.append(lambda r: (str(r.get(key) or "").lower().startswith(needle) if starts else needle in str(r.get(key) or "").lower()))
        return self

    def order(self, key, desc=False):
        self._order = (key, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    # writes
    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.op, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def _match(self, row):
        return all(f(row) for f in self.filters)

    def _new(self, row):
        row = {**DEFAULTS.get(self.name, {}), **copy.deepcopy(row)}
        if self.name in ID_TABLES and not row.get("id"):
            row["id"] = str(uuid.uuid4()) if self.name != "canvas_activity" else len(self.db.rows(self.name)) + 1
        if "created_at" not in row:
            self.db._clock += 1
            row["created_at"] = f"2026-10-15T00:00:{self.db._clock % 60:02d}+00:00"
        return row

    def execute(self):
        rows = self.db.rows(self.name)
        if self.op == "select":
            out = [copy.deepcopy(r) for r in rows if self._match(r)]
            if self._order:
                key, desc = self._order
                out.sort(key=lambda r: (r.get(key) is None, str(r.get(key) or "")), reverse=desc)
            out = out[: self._limit] if self._limit else out
            if self.columns:
                out = [{c: r.get(c) for c in self.columns} for r in out]
            return SimpleNamespace(data=out)
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            made = [self._new(r) for r in items]
            rows.extend(made)
            return SimpleNamespace(data=copy.deepcopy(made))
        if self.op == "upsert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            keys = (self.on_conflict or "id").split(",")
            out = []
            for item in items:
                found = next((r for r in rows if all(r.get(k) == item.get(k) for k in keys)), None)
                if found:
                    found.update(copy.deepcopy(item))
                    out.append(copy.deepcopy(found))
                else:
                    made = self._new(item)
                    rows.append(made)
                    out.append(copy.deepcopy(made))
            return SimpleNamespace(data=out)
        if self.op == "update":
            out = []
            for r in rows:
                if self._match(r):
                    r.update(copy.deepcopy(self.payload))
                    out.append(copy.deepcopy(r))
            return SimpleNamespace(data=out)
        if self.op == "delete":
            gone = [r for r in rows if self._match(r)]
            self.db.tables[self.name] = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=gone)
        raise AssertionError(self.op)
