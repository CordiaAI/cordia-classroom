"""Phase 5 apps: Dropbox class folders, GitHub repos on assignments, the Sheets export and Slack."""
import base64
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
from services import composio, dropbox_sync, github_sync, sheets_export, slack_sync  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
NOW = datetime.now(timezone.utc).replace(microsecond=0)


class AppTest(unittest.TestCase):
    modules = ()

    def setUp(self):
        self.db = FakeDB()
        self.calls = []
        self.answers = {}
        self.patches = [patch("services.sync_state.get_supabase", return_value=self.db),
                        patch("services.composio.active_accounts", return_value={"dropbox": "ca_d", "github": "ca_g", "gsheets": "ca_s", "slack": "ca_k"}),
                        patch("services.composio.run", side_effect=self.run_tool)]
        self.patches += [patch(f"services.{m}.get_supabase", return_value=self.db) for m in self.modules]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def run_tool(self, account, user, slug, args):
        self.calls.append((slug, args))
        answer = self.answers.get(slug, {})
        if isinstance(answer, Exception):
            raise answer
        return answer(args) if callable(answer) else answer

    def stats(self, connector):
        row = next((r for r in self.db.rows("connector_settings") if r["connector"] == connector), {})
        return row.get("stats") or {}


class ComposioData(unittest.TestCase):
    def run_with(self, data):
        class Response:
            ok, status_code, content = True, 200, b"x"

            def json(self):
                return {"successful": True, "data": data}
        with patch("services.composio._request", return_value=Response()):
            return composio.run("ca", USER, "ANY", {})

    def test_string_and_list_data_become_objects(self):
        self.assertEqual(self.run_with('{"a": 1}'), {"a": 1})
        self.assertEqual(self.run_with("plain words"), {"text": "plain words"})
        self.assertEqual(self.run_with([1, 2]), {"items": [1, 2]})


class Dropbox(AppTest):
    modules = ("dropbox_sync",)

    def setUp(self):
        super().setUp()
        self.db.rows("connector_links").append({"user_id": USER, "connector": "dropbox", "kind": "file", "cordia_id": "folder:lib-1",
                                                "external_id": "id:folder", "container_id": "BIO 101"})
        body = base64.b64encode(b"Cell membranes control what enters and leaves the cell. " * 3).decode()
        self.answers = {
            "DROPBOX_LIST_FILES_IN_FOLDER": {"entries": [
                {".tag": "file", "id": "id:a", "name": "Week 1.txt", "path_lower": "/bio/week 1.txt", "server_modified": "2026-10-20T10:00:00Z", "size": 100},
                {".tag": "file", "id": "id:b", "name": "lecture.mp4", "path_lower": "/bio/lecture.mp4", "server_modified": "2026-10-21T10:00:00Z", "size": 100},
                {".tag": "folder", "id": "id:c", "name": "Old", "path_lower": "/bio/old"},
            ]},
            "DROPBOX_READ_FILE": {"file_content_bytes": body},
        }
        self.imported = []
        self.upsert = patch("services.library_import.upsert_source", side_effect=lambda *a, **k: self.imported.append(k) or {"id": "g"})
        self.upsert.start()

    def tearDown(self):
        self.upsert.stop()
        super().tearDown()

    def test_readable_files_come_into_the_class_once(self):
        self.assertEqual(dropbox_sync.sync_folders(USER), {"imported": 1})
        self.assertEqual(self.imported[0]["folder_id"], "lib-1")
        self.assertEqual(self.imported[0]["ref"], "dropbox:id:a")
        self.assertIn("Cell membranes", self.imported[0]["text"])
        self.assertEqual(dropbox_sync.sync_folders(USER), {"imported": 0})

    def test_single_import_uses_the_same_id_as_the_folder_sync(self):
        files = dropbox_sync.search_files(USER, "")
        self.assertEqual([f["id"] for f in files], ["id:a"])

    def test_links_read_like_drive(self):
        self.assertEqual(dropbox_sync.links(USER)[0]["drive_folder_name"], "BIO 101")
        dropbox_sync.unlink(USER, "lib-1")
        self.assertEqual(dropbox_sync.links(USER), [])
        self.assertIs(self.stats("dropbox")["linked"], False)


class GitHub(AppTest):
    modules = ("github_sync",)

    def commits(self, *days_ago):
        return {"commits": [{"commit": {"message": f"work {d}\nmore", "author": {"date": (NOW - timedelta(days=d)).isoformat()}},
                             "html_url": f"https://github.com/me/lab/commit/{d}"} for d in days_ago]}

    def test_activity_counts_commits_per_day(self):
        self.answers["GITHUB_LIST_COMMITS"] = self.commits(0, 0, 3)
        act = github_sync.activity(USER, "me/lab", NOW)
        self.assertEqual(act["per_day"][-1], 2)
        self.assertEqual(act["per_day"][-4], 1)
        self.assertEqual(act["total"], 3)
        self.assertEqual(act["last"]["message"], "work 0")

    def test_bad_repo_names_are_refused(self):
        with self.assertRaises(HTTPException):
            github_sync.link_repo(USER, "canvas-1", "../etc/passwd")

    def test_quiet_repo_near_its_deadline_gets_one_nudge_a_day(self):
        self.db.rows("connector_links").append({"user_id": USER, "connector": "github", "kind": "file", "cordia_id": "repo:canvas-1", "external_id": "me/lab"})
        item = {"id": "canvas-1", "title": "Lab 3", "due_at": (NOW + timedelta(days=2)).isoformat(), "course": "CS 101", "done": False}
        self.answers["GITHUB_LIST_COMMITS"] = self.commits(4)
        with patch("routers.calendar.calendar_for", return_value={"items": [item]}):
            self.assertEqual(github_sync.check_repos(USER), 1)
            self.assertEqual(github_sync.check_repos(USER), 0)
        alert = self.stats("github")["alerts"][0]
        self.assertEqual((alert["kind"], alert["item_key"], alert["repo"]), ("repo_quiet", "canvas-1", "me/lab"))

    def test_active_repo_is_left_alone(self):
        self.db.rows("connector_links").append({"user_id": USER, "connector": "github", "kind": "file", "cordia_id": "repo:canvas-1", "external_id": "me/lab"})
        item = {"id": "canvas-1", "title": "Lab 3", "due_at": (NOW + timedelta(days=2)).isoformat(), "done": False}
        self.answers["GITHUB_LIST_COMMITS"] = self.commits(0)
        with patch("routers.calendar.calendar_for", return_value={"items": [item]}):
            self.assertEqual(github_sync.check_repos(USER), 0)

    def test_tutor_reads_source_not_vendored_files(self):
        self.db.rows("connector_links").append({"user_id": USER, "connector": "github", "kind": "file", "cordia_id": "repo:canvas-1",
                                                "external_id": "me/lab", "container_id": "main"})
        self.answers["GITHUB_GET_A_TREE"] = {"tree": [
            {"type": "blob", "path": "README.md", "size": 20}, {"type": "blob", "path": "src/main.py", "size": 40},
            {"type": "blob", "path": "node_modules/x/index.js", "size": 10}, {"type": "tree", "path": "src"},
        ]}
        self.answers["GITHUB_GET_REPOSITORY_CONTENT"] = lambda args: {"content": base64.b64encode(f"contents of {args['path']}".encode()).decode()}
        text = github_sync.repo_text(USER, "canvas-1")
        self.assertIn("contents of README.md", text)
        self.assertIn("contents of src/main.py", text)
        self.assertNotIn("node_modules", text)


class Sheets(AppTest):
    modules = ("sheets_export",)

    def setUp(self):
        super().setUp()
        self.db.rows("canvas_courses").extend([
            {"user_id": USER, "name": "Biology", "course_code": "BIO 101", "current_score": 91.5, "current_grade": "A-", "grade_checked_at": "2026-10-25T00:00:00+00:00"},
            {"user_id": USER, "name": "Art", "course_code": "ART 1", "current_score": None, "current_grade": None},
        ])
        self.db.rows("study_sessions").extend([
            {"user_id": USER, "started_at": (NOW - timedelta(hours=1)).isoformat(), "duration_seconds": 600, "session_type": "quiz"},
            {"user_id": USER, "started_at": (NOW - timedelta(hours=1)).isoformat(), "duration_seconds": 900, "session_type": "flashcards"},
        ])
        self.answers = {"GOOGLESHEETS_CREATE_GOOGLE_SHEET1": {"response_data": {"spreadsheetId": "sheet-1"}}}

    def test_rows(self):
        grades = sheets_export.grade_rows(USER)
        self.assertEqual(grades[1][:4], ["Biology", "BIO 101", 91.5, "A-"])
        self.assertEqual(len(grades), 2)  # Art has no grade yet.
        study = sheets_export.study_rows(USER, "UTC", NOW)
        self.assertEqual(study[1][1:], [2, 25, 1, 1])

    def test_export_makes_the_sheet_and_writes_both_tabs(self):
        out = sheets_export.export(USER, "America/Chicago")
        self.assertEqual(out["spreadsheet_id"], "sheet-1")
        written = [args["range"] for slug, args in self.calls if slug == "GOOGLESHEETS_VALUES_UPDATE"]
        self.assertEqual(written, ["'Grades'!A1", "'Study time'!A1"])
        self.assertEqual(sheets_export.status(USER)["url"], "https://docs.google.com/spreadsheets/d/sheet-1/edit")

    def test_a_deleted_sheet_is_made_again(self):
        sheets_export.export(USER)
        failed = []

        def clear(args):
            if args["spreadsheet_id"] == "sheet-1" and not failed:
                failed.append(1)
                raise HTTPException(status_code=502)
            return {}
        self.answers["GOOGLESHEETS_CLEAR_VALUES"] = clear
        self.answers["GOOGLESHEETS_CREATE_GOOGLE_SHEET1"] = {"spreadsheetId": "sheet-2"}
        self.assertEqual(sheets_export.export(USER)["spreadsheet_id"], "sheet-2")

    def test_daily_export_stops_quietly_when_disconnected(self):
        with patch("services.composio.active_accounts", return_value={}):
            sheets_export.auto_export(USER)
        self.assertTrue(next(r for r in self.db.rows("connector_settings") if r["connector"] == "gsheets")["needs_reconnect"])


class Slack(AppTest):
    modules = ("slack_sync",)

    def test_clean_reads_slack_markup(self):
        self.assertEqual(slack_sync._clean("<!here> exam moved, see <https://x.edu/a|the page> <@U123>"), "@here exam moved, see the page")

    def test_watch_list_drops_bad_ids_and_starts_now(self):
        picked = slack_sync.set_watched(USER, [{"id": "C0123456", "name": "bio-101"}, {"id": "../x", "name": "bad"}])
        self.assertEqual([c["id"] for c in picked], ["C0123456"])
        self.assertIn("C0123456", self.stats("slack")["cursor"])

    def test_watch_sorts_posts_into_date_changes_and_announcements(self):
        slack_sync.set_watched(USER, [{"id": "C0123456", "name": "bio-101"}])
        ts = float(self.stats("slack")["cursor"]["C0123456"])  # Posts after watching started.
        self.answers["SLACK_FETCH_CONVERSATION_HISTORY"] = {"messages": [
            {"ts": f"{ts + 3:.6f}", "text": "The midterm is moved to Thursday, Nov 6 at 2pm"},
            {"ts": f"{ts + 2:.6f}", "text": "<!channel> Lab reports are due Friday"},
            {"ts": f"{ts + 1:.6f}", "text": "anyone want to get lunch later today?"},
            {"ts": f"{ts + 4:.6f}", "subtype": "channel_join", "text": "joined the channel #bio"},
        ]}
        proposed = []
        with patch("services.mail_watch.upcoming", return_value=[]), \
             patch("services.mail_watch.propose", side_effect=lambda *a, **k: proposed.append(k) or int("midterm" in k["text"])):
            result = slack_sync.watch(USER)
        self.assertEqual(result["found"], 1)
        self.assertEqual(proposed[0]["source"], "slack")
        self.assertEqual(proposed[0]["sender"], "#bio-101 (Slack)")
        alerts = self.stats("slack")["alerts"]
        self.assertEqual([a["kind"] for a in alerts], ["slack_post"])
        self.assertEqual(alerts[0]["title"], "@channel Lab reports are due Friday")
        self.assertEqual(result["checked"], 3)
        self.assertEqual(self.stats("slack")["cursor"]["C0123456"], f"{ts + 4:.6f}")

    def test_study_session_posts_and_reminds_once(self):
        when = NOW + timedelta(hours=3)
        out = slack_sync.post_session(USER, {"id": "C0123456", "name": "study"}, "Cell biology", when.isoformat(), "Tue 7pm", "Library 2F", 60)
        self.assertTrue(out["posted"])
        self.assertIn("Cell biology", self.calls[-1][1]["markdown_text"])
        later = when - timedelta(minutes=59)
        self.assertEqual(slack_sync.send_reminders(USER, later), 1)
        self.assertEqual(slack_sync.send_reminders(USER, later), 0)
        self.assertIsNone(self.stats("slack")["next_reminder"])

    def test_past_times_are_refused(self):
        with self.assertRaises(HTTPException):
            slack_sync.post_session(USER, {"id": "C0123456"}, "Review", (NOW - timedelta(hours=1)).isoformat(), "earlier", "")


if __name__ == "__main__":
    unittest.main()
