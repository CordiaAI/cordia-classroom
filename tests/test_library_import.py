"""Phase 2: course material into Library (Canvas modules, Drive folders), review sets, save to Drive."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
FOLDER = "f0000000-0000-4000-8000-000000000001"
NOW = datetime.now(timezone.utc).replace(microsecond=0)
TEXT = "Cell Energy\nATP is the energy currency of the cell.\n- Mitochondria make ATP through respiration."


class Base(unittest.TestCase):
    modules = ("services.library_import", "services.sync_state", "services.drive_sync", "services.google_sync", "routers.plans", "routers.drive")

    def setUp(self):
        self.db = FakeDB()
        self.db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "BIO 101", "class_id": "class-1"})
        self.patches = [patch(f"{m}.get_supabase", return_value=self.db) for m in self.modules]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()


class LibraryImport(Base):
    def test_imports_once_as_an_outline_and_refreshes_only_untouched_notes(self):
        from services import library_import
        guide = library_import.upsert_source(USER, ref="gdrive:f1", connector="gdrive", title="Week 1", text=TEXT, folder_id=FOLDER,
                                             source_type="gdrive", source_title="Google Drive · BIO")
        self.assertIn("## Cell Energy", guide["notes"])
        self.assertIn("- ATP is the energy currency of the cell.", guide["notes"])
        library_import.upsert_source(USER, ref="gdrive:f1", connector="gdrive", title="Week 1", text=TEXT + "\nNew point here.",
                                     folder_id=FOLDER, source_type="gdrive", source_title="x")
        rows = self.db.rows("study_guides")
        self.assertEqual(len(rows), 1)
        self.assertIn("New point here.", rows[0]["notes"])
        rows[0]["notes"] = "## My own notes\n- edited by me"
        library_import.upsert_source(USER, ref="gdrive:f1", connector="gdrive", title="Week 1", text=TEXT + "\nAnother.",
                                     folder_id=FOLDER, source_type="gdrive", source_title="x")
        self.assertEqual(self.db.rows("study_guides")[0]["notes"], "## My own notes\n- edited by me")

    def test_empty_text_imports_nothing(self):
        from services import library_import
        self.assertIsNone(library_import.upsert_source(USER, ref="gdrive:f2", connector="gdrive", title="x", text="  ",
                                                       folder_id=FOLDER, source_type="gdrive", source_title="x"))


class DriveSync(Base):
    def run_tool(self, account, user, slug, args):
        self.calls.append((slug, args))
        if slug == "GOOGLEDRIVE_FIND_FILE":
            if "'root' in parents" in args["q"]:
                return {"files": []}
            return {"files": [{"id": "d1", "name": "Lecture 1.pdf", "mimeType": "application/pdf", "webViewLink": "https://drive/x"},
                              {"id": "d2", "name": "photo.png", "mimeType": "image/png"}]}
        if slug == "GOOGLEDRIVE_CREATE_FOLDER":
            return {"id": "cordia-folder"}
        if slug == "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT":
            return {"id": f"saved{len(self.calls)}"}
        if slug == "GOOGLEDRIVE_TRASH_FILE":
            return {}
        raise AssertionError(slug)

    def setUp(self):
        super().setUp()
        self.calls = []
        from fastapi import HTTPException

        def text(acct, user, file_id):
            if file_id == "d2":
                raise HTTPException(status_code=415, detail="no text")
            return TEXT
        self.more = [patch("services.composio.run", side_effect=self.run_tool), patch("services.composio.account_for", return_value="ca"),
                     patch("services.composio.active_accounts", return_value={"gdrive": "ca"}), patch("services.drive_sync._drive_text", side_effect=text)]
        for p in self.more:
            p.start()

    def tearDown(self):
        for p in self.more:
            p.stop()
        super().tearDown()

    def test_linking_a_folder_imports_its_files_into_the_class_and_remembers_when(self):
        from services import drive_sync
        result = drive_sync.link(USER, FOLDER, "drivefolder1", "BIO notes")
        self.assertEqual(result["imported"], 1)  # The image has no text and is skipped.
        guide = self.db.rows("study_guides")[0]
        self.assertEqual((guide["folder_id"], guide["external_source_id"], guide["source_url"]), (FOLDER, "gdrive:d1", "https://drive/x"))
        self.assertEqual(drive_sync.links(USER)[0]["drive_folder_name"], "BIO notes")
        checked = next(r for r in self.db.rows("connector_settings") if r["connector"] == "gdrive")["stats"]["folders_checked"]
        self.assertIn("drivefolder1", checked)
        drive_sync.sync_folders(USER)
        self.assertIn("modifiedTime >", [a for s, a in self.calls if s == "GOOGLEDRIVE_FIND_FILE"][-1]["q"])
        self.assertEqual(len(self.db.rows("study_guides")), 1)

    def test_saving_again_replaces_the_drive_copy(self):
        from services import drive_sync
        first = drive_sync.save_copy(USER, "g1", "guide", "Cells", "# Cells")
        second = drive_sync.save_copy(USER, "g1", "guide", "Cells", "# Cells v2")
        self.assertNotEqual(first["file_id"], second["file_id"])
        self.assertEqual([a["file_id"] for s, a in self.calls if s == "GOOGLEDRIVE_TRASH_FILE"], [first["file_id"]])
        made = [a for s, a in self.calls if s == "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT"]
        self.assertTrue(all(a["parent_id"] == "cordia-folder" for a in made))
        self.assertEqual(len([s for s, _ in self.calls if s == "GOOGLEDRIVE_CREATE_FOLDER"]), 1)


class ReviewSets(Base):
    def test_review_gathers_the_class_material_under_source_headings(self):
        from routers import plans
        from services import library_import
        library_import.upsert_source(USER, ref="canvas:file:1", connector="canvas", title="Lecture 1", text=TEXT, folder_id=FOLDER,
                                     source_type="canvas_module", source_title="BIO 101 · Module 1")
        self.db.rows("study_guides").append({"id": "own", "user_id": USER, "folder_id": FOLDER, "title": "My notes",
                                             "notes": "- Osmosis moves water", "study_guide": "", "created_at": "2026-01-01"})
        guide = plans.build_review(USER, FOLDER, "Midterm: review", "review:canvas-9")
        self.assertIn("## Lecture 1 · Cell Energy", guide["notes"])
        self.assertIn("## My notes\n- Osmosis moves water", guide["notes"])
        plans.build_review(USER, FOLDER, "Midterm: review", "review:canvas-9")
        self.assertEqual(len([g for g in self.db.rows("study_guides") if g.get("source_type") == "review"]), 1)
        only = plans.build_review(USER, FOLDER, "Module 1 review", "review:m1", prefix="BIO 101 · Module 1")
        self.assertNotIn("Osmosis", only["notes"])

    def test_no_material_says_how_to_add_some(self):
        from fastapi import HTTPException
        from routers import plans
        with self.assertRaises(HTTPException) as caught:
            plans.build_review(USER, FOLDER, "x", "review:x")
        self.assertIn("Link a Drive folder", caught.exception.detail)


class ReviewSubtasks(Base):
    def test_review_sessions_become_subtasks_of_the_exam_and_check_off_both_ways(self):
        from services import google_sync
        due = (NOW + timedelta(days=5)).isoformat()
        items = [{"id": "canvas-9", "title": "Midterm", "due_at": due, "done": False}]
        self.db.rows("connector_settings").append({"user_id": USER, "connector": "gtasks", "container_id": "list", "stats": {"time_zone": "UTC"}})
        start = NOW + timedelta(days=2)
        self.db.rows("study_blocks").append({"id": "r1", "user_id": USER, "item_key": "canvas-9", "kind": "review", "status": "planned",
                                             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=45)).isoformat()})
        remote = {}

        def run(account, user, slug, args):
            if slug == "GOOGLETASKS_LIST_TASKS":
                return {"tasks": list(remote.values())}
            if slug == "GOOGLETASKS_INSERT_TASK":
                remote[f"t{len(remote) + 1}"] = {"id": f"t{len(remote) + 1}", "status": "needsAction", **args}
                return {"id": f"t{len(remote)}"}
            return {}
        with patch("services.composio.active_accounts", return_value={"gtasks": "ca"}), patch("services.composio.run", side_effect=run), \
                patch("routers.calendar.calendar_for", return_value={"items": items}):
            google_sync.sync_tasks(USER)
            self.assertEqual(remote["t2"]["title"], "Review session · 45 min")
            self.assertEqual(remote["t2"]["task_parent"], "t1")
            remote["t2"]["status"] = "completed"
            google_sync.sync_tasks(USER)
        self.assertEqual(self.db.rows("study_blocks")[0]["status"], "done")


class CanvasModules(Base):
    modules = Base.modules + ("routers.canvas",)

    def test_auto_import_classes_bring_module_files_in_once_and_finished_modules_alert(self):
        from routers import canvas

        class Client:
            def modules(self, course_id):
                return [{"id": 1, "name": "Week 1", "state": "completed", "items": [
                    {"type": "File", "content_id": 5, "title": "Slides 1"},
                    {"type": "Page", "page_url": "reading-1", "title": "Reading"},
                    {"type": "Assignment", "content_id": 7, "title": "Quiz"}]}]

            def download_file(self, course_id, file_id):
                return "slides.txt", TEXT.encode()

            def page(self, course_id, slug):
                return {"body": "<h2>Diffusion</h2><p>Particles spread from high to low concentration.</p>"}
        self.db.rows("canvas_courses").append({"user_id": USER, "canvas_course_id": 3, "name": "BIO 101", "class_id": "class-1"})
        self.db.rows("connector_settings").append({"user_id": USER, "connector": "canvas", "stats": {"auto_import": [3]}})
        imported = canvas._sync_modules(self.db, USER, Client(), {3: {"name": "BIO 101"}}, force=True)
        self.assertEqual(imported, 2)
        refs = sorted(g["external_source_id"] for g in self.db.rows("study_guides"))
        self.assertEqual(refs, ["canvas:file:5", "canvas:page:3:reading-1"])
        self.assertTrue(all(g["folder_id"] == FOLDER and g["source_title"] == "BIO 101 · Week 1" for g in self.db.rows("study_guides")))
        self.assertEqual(canvas._sync_modules(self.db, USER, Client(), {3: {"name": "BIO 101"}}, force=True), 0)
        alerts = next(r for r in self.db.rows("connector_settings") if r["connector"] == "canvas")["stats"]["alerts"]
        self.assertEqual([a["kind"] for a in alerts], ["module_done"])  # Once, not every run.


    def test_a_page_that_only_links_to_the_slides_imports_the_slides(self):
        from routers import canvas
        from services import library_import
        body = '<p><a class="instructure_file_link" href="https://school.instructure.com/courses/3/files/9?wrap=1" data-api-endpoint="https://school.instructure.com/api/v1/courses/3/files/9">Chapters 18 - 20-1.pptx</a></p>'

        class Client:
            downloads = []

            def modules(self, course_id):
                return [{"id": 1, "name": "Power Points", "items": [
                    {"type": "Page", "page_url": "chapters-18-20-2", "title": "Chapters 18 - 20"},
                    {"type": "File", "content_id": 9, "title": "Chapters 18 - 20-1.pptx"}]}]

            def download_file(self, course_id, file_id):
                Client.downloads.append(file_id)
                return "slides.txt", TEXT.encode()

            def page(self, course_id, slug):
                return {"body": body}
        self.db.rows("canvas_courses").append({"user_id": USER, "canvas_course_id": 3, "name": "BUS 150", "class_id": "class-1"})
        self.db.rows("connector_settings").append({"user_id": USER, "connector": "canvas", "stats": {"auto_import": [3]}})
        # Imported before linked files were read: just the link's name. The student never edited it.
        self.db.rows("study_guides").append({"id": "g-old", "user_id": USER, "title": "Chapters 18 - 20", "notes": "- Chapters 18 - 20-1.pptx",
                                             "external_source_id": "canvas:page:3:chapters-18-20-2", "folder_id": FOLDER})
        self.db.rows("connector_links").append({"user_id": USER, "connector": "canvas", "kind": "file", "cordia_id": "g-old",
                                                "external_id": "canvas:page:3:chapters-18-20-2", "synced_hash": library_import._hash("- Chapters 18 - 20-1.pptx")})
        canvas._sync_modules(self.db, USER, Client(), {3: {"name": "BUS 150"}}, force=True)
        guides = self.db.rows("study_guides")
        self.assertEqual(len(guides), 1, "the slides aren't imported a second time as their own guide")
        self.assertIn("ATP is the energy currency", guides[0]["notes"])
        self.assertNotIn(".pptx", guides[0]["notes"], "the link's name gives way to the slides themselves")
        self.assertEqual(Client.downloads, [9])


if __name__ == "__main__":
    unittest.main()
