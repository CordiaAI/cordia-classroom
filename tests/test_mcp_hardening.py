"""MCP hardening (Phase 5): the backend's /mcp routes never reach LMS or connector code (hard rules
1 and 2), and a connected app's study set goes all the way through: queued, claimed, built, saved
and reported done."""
import ast
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402

# Code that talks to an LMS or another connected service, or reads what they stored.
FORBIDDEN_MODULES = {
    "services.canvas_client", "routers.canvas", "routers.calendar", "routers.connectors", "routers.drive",
    "routers.plans", "routers.chat", "routers.classes", "services.class_db", "services.grades", "services.sync_state",
    "services.sync_worker", "services.google_sync", "services.drive_sync", "services.dropbox_sync", "services.github_sync",
    "services.notion_sync", "services.docs_sync", "services.sheets_export", "services.slack_sync", "services.mail_watch",
    "services.composio", "services.connector_settings", "services.deadlines", "services.library_import", "services.planner",
}
FORBIDDEN_TABLES = ("canvas_", "connector_settings", "connector_links", "assistant_", "deadline_changes", "assignment_plans",
                    "assignment_steps", "study_blocks", "deadline_marks", "canvas_calendar_connections")


def _path(module: str):
    base = BACKEND.joinpath(*module.split("."))
    for candidate in (base.with_suffix(".py"), base / "__init__.py"):
        if candidate.exists():
            return candidate
    return None


def _imports(path: Path) -> set:
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return {name for name in found if _path(name)}


def reachable(start: str) -> set:
    """Every backend module the start module imports, directly or through others (imports inside
    functions included)."""
    seen, stack = set(), [start]
    while stack:
        module = stack.pop()
        if module in seen:
            continue
        seen.add(module)
        stack.extend(_imports(_path(module)))
    return seen


class HardRuleTests(unittest.TestCase):
    def test_mcp_routes_never_reach_lms_or_connector_code(self):
        modules = reachable("routers.mcp")
        self.assertIn("services.generation_jobs", modules)  # the walk does follow the routes' imports
        self.assertEqual(sorted(modules & FORBIDDEN_MODULES), [])

    def test_reachable_code_never_reads_lms_or_connector_tables(self):
        problems = []
        for module in sorted(reachable("routers.mcp")):
            source = _path(module).read_text()
            for table in FORBIDDEN_TABLES:
                if f'table("{table}' in source or f"table('{table}" in source:
                    problems.append(f"{module} reads {table}")
        self.assertEqual(problems, [])

    def test_lms_hosts_appear_only_in_the_link_blocklist(self):
        for module in sorted(reachable("routers.mcp") - {"services.url_fetch"}):
            source = _path(module).read_text().lower()
            for host in ("instructure.com", "blackboard.com", "moodlecloud.com", "brightspace.com", "schoology.com"):
                self.assertNotIn(host, source, f"{module} names {host}")


class StudySetLifecycleTests(unittest.TestCase):
    """create_study_set from a connected app: queued under the student, built by the worker, then
    get_job_status and the app both see the saved set."""

    def setUp(self):
        from routers import jobs, mcp
        from services import generation_jobs
        self.jobs, self.mcp, self.worker = jobs, mcp, generation_jobs
        self.db = FakeDB()
        db = self.db

        def rpc(name, args):
            assert name == "queue_study_set_job"
            row = db.table("generation_jobs").insert({
                "user_id": "student-1", "status": "queued", "attempts": 0, "kind": "study_set", "source": "mcp",
                "title": args["title"], "client_name": "Claude", "created_at": datetime.now(timezone.utc).isoformat(),
                "input": {"kind": args["source_kind"], "text": args["source_text"], "outputs": args["outputs"]},
            }).execute().data[0]
            return type("R", (), {"execute": lambda _self: type("D", (), {"data": row["id"]})()})()

        db.rpc = rpc
        self.patches = [
            patch.object(mcp, "_student", return_value=("student-1", db)),
            patch.object(generation_jobs, "get_supabase", return_value=db),
            patch.object(jobs, "get_supabase", return_value=db),
            patch.object(jobs, "get_user_id", side_effect=lambda auth: auth.split()[-1]),
            patch("routers.guides.get_supabase", return_value=db),
            patch("routers.guides.start_quiz_warmup"),
            patch("routers.guides.guide_title", side_effect=lambda title, text, keep=False: title),
            patch("services.entitlements.require"),
            patch("services.entitlements.record"),
            patch("routers.materials.build_materials", return_value={
                "notes": "- Plants turn light into chemical energy", "study_guide": "Q1: Where does photosynthesis happen?\nA1: In the chloroplasts",
                "flashcards": [{"front": "Where does photosynthesis happen?", "back": "In the chloroplasts"}], "empty": False}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_queue_claim_build_save_and_report(self):
        body = self.mcp.StudySetRequest(source=self.mcp.StudySetSource(type="text", text="Photosynthesis happens in the chloroplasts. " * 3), title="Photosynthesis")
        queued = self.mcp._queue_study_set("Bearer token", body)
        self.assertEqual(queued["status"], "queued")

        job = self.worker.claim_next()
        self.assertEqual((job["id"], job["status"]), (queued["job_id"], "running"))
        self.worker.run(job)

        row = next(r for r in self.db.rows("generation_jobs") if r["id"] == queued["job_id"])
        self.assertEqual((row["status"], row["progress"], row["input"], row["error"]), ("done", 1, None, None))
        guide = next(g for g in self.db.rows("study_guides") if g["id"] == row["study_set_id"])
        self.assertEqual((guide["user_id"], guide["title"], guide["origin"], guide["origin_client"]), ("student-1", "Photosynthesis", "mcp", "Claude"))
        self.assertEqual(guide["flashcards"][0]["front"], "Where does photosynthesis happen?")

        # The app hears about it once, and its job page returns the saved set.
        unseen = self.jobs.unseen_jobs(authorization="Bearer student-1")["jobs"]
        self.assertEqual([j["id"] for j in unseen], [queued["job_id"]])
        status = self.jobs.job_status(queued["job_id"], authorization="Bearer student-1")
        self.assertEqual(status["guide"]["id"], guide["id"])
        self.assertIsNone(self.worker.claim_next(), "nothing left to build")


if __name__ == "__main__":
    unittest.main()
