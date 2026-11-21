"""F1 round 3 (#285): the reviewer's probes (rook-f1c probe5.py, probe6.py, probe7.py) as tests.

H1: no shared cleaning step drops a "Database:" or "Sub-page:" line: in a course's own notes they are
content ("- Database: Westlaw and LexisNexis"). Only the exact lines the first Notion import (F1) wrote
about itself are left out, and only for guides that import filed (external_source_id "notion:...", made
since F1 went live). H2: every place a guide's notes reach a model applies that rule: Practice, NCLEX,
the guide Tutor, chat "make", the Tutor's material, review guides and memory snippets (and the web's
study set, in web/tests/import-lines.test.mjs). L5: a call that waits for one of the student's three
slots waits only until its read's deadline, so no call starts after the read gave up. The real Notion,
Composio and model APIs are never called."""
from pathlib import Path
import json
import re
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fastapi import HTTPException  # noqa: E402

from test_notion_review import PAGE, USER, SlowNotion, block  # noqa: E402

GID = "11111111-2222-4333-8444-000000000001"
H = {"Authorization": "Bearer t"}
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "f1_import_lines.json").read_text())["lines"]
SQL = (ROOT / "supabase" / "oneoff" / "20261119_clean_notion_import_lines.sql").read_text()

# What F1 filed for a Notion page (probe5's F1 notes), and the lines in it that F1 wrote about itself.
F1_NOTES = ("## Week 3\n- Glycolysis makes ATP\n- The rest of this Notion page wasn't imported because Notion was slow to answer.\n"
            "- Sub-page: Lecture 4\n- Database: Reading list\n## Sub-page: Lab 2\n- Mitochondria are the site of the Krebs cycle "
            "in the matrix of the cell")
F1_LINES = ("wasn't imported", "Sub-page: Lecture 4", "Database: Reading list", "Sub-page: Lab 2")
F1_KEPT = ("Glycolysis makes ATP", "Krebs cycle")
# probe7: a course's own lines that start like F1's (kept in every source, every consumer).
COURSE_LINES = ("- Database: organized collection of related data", "- Database: Westlaw and LexisNexis",
                "## Database: Design principles", "- Sub-page: a page nested under a parent page")
COURSE_NOTES = "## Data and law\n" + "\n".join(COURSE_LINES) + "\n- Normalization removes redundancy in tables"
IN_WINDOW = "2026-11-19T05:00:00.123456+00:00"
BEFORE_F1 = "2026-11-10T12:00:00+00:00"


def f1_guide(**extra):
    return {"id": GID, "user_id": USER, "title": "Week 3", "notes": F1_NOTES, "study_guide": "", "folder_id": None,
            "nclex_questions": None, "source_url": None, "external_source_id": "notion:p1", "created_at": IN_WINDOW, **extra}


def course_guides():
    """The course lines in guides from every kind of source: never touched."""
    base = {"user_id": USER, "title": "Data and law", "notes": COURSE_NOTES, "study_guide": "", "folder_id": None,
            "nclex_questions": None, "source_url": None, "created_at": IN_WINDOW}
    return [
        {**base, "external_source_id": "canvas:123"},
        {**base, "external_source_id": "gdrive:abc"},
        {**base, "external_source_id": None},
        {**base, "external_source_id": "notion:old", "created_at": BEFORE_F1},  # the Notion import before F1 wrote none
    ]


def leaks(text):
    return [line for line in F1_LINES if line in (text or "")]


def lost(text):
    """Course lines missing from `text` (a review guide puts its source's name before a heading, so the
    line's own words are what is looked for)."""
    return [line for line in COURSE_LINES if line.split(" ", 1)[1] not in (text or "")]


class TheRule(unittest.TestCase):
    def test_every_fixture_line_is_judged_as_the_sql_and_the_web_judge_it(self):
        from services.text_processing import is_f1_import_line
        for line, wanted in FIXTURE:
            self.assertEqual(is_f1_import_line(line), wanted, repr(line))

    def test_the_closing_sentences_are_the_ones_f1_wrote(self):
        import subprocess
        from services.text_processing import F1_IMPORT_NOTES
        f1 = subprocess.run(["git", "show", "095b6c6:backend/services/notion_text.py"], cwd=ROOT, capture_output=True, text=True)
        if f1.returncode:
            self.skipTest("F1's commit isn't in this clone")
        written = re.findall(r'"(?:time|size|missed)": "([^"]+)"', f1.stdout)
        self.assertEqual(sorted(written), sorted(F1_IMPORT_NOTES))
        self.assertIn('self.lines.append(f"{\'  \' * indent}{_SUBPAGES[kind]}: {title}")', f1.stdout)

    def test_the_sql_and_the_web_use_the_same_window(self):
        from services.text_processing import F1_NOTION_LIVE
        self.assertEqual(F1_NOTION_LIVE, "2026-11-19T01:45:00+00:00")
        self.assertEqual(SQL.count("timestamptz '2026-11-19 01:45:00+00' as f1_live"), 2)
        self.assertIn("Date.parse('2026-11-19T01:45:00Z')", (ROOT / "web" / "lib" / "studySet.mjs").read_text())

    def test_only_guides_f1_filed(self):
        from services.text_processing import from_f1_notion_import
        self.assertTrue(from_f1_notion_import(f1_guide()))
        self.assertTrue(from_f1_notion_import(f1_guide(created_at="2026-11-19T01:47:00Z")))
        self.assertTrue(from_f1_notion_import({"external_source_id": "notion:p1"}))  # a row read without created_at
        self.assertFalse(from_f1_notion_import(f1_guide(created_at=BEFORE_F1)))
        for source in ("canvas:1", "gdrive:x", "gdocs:x", "dropbox:x", "", None, "Notion:p1", "xnotion:p1"):
            self.assertFalse(from_f1_notion_import(f1_guide(external_source_id=source)), source)
        self.assertFalse(from_f1_notion_import(None))


class H1CourseLinesAreKeptEverywhere(unittest.TestCase):
    """probe7: lost [] for every case."""

    CASES = {
        "CS notes": "Intro to Information Systems\n- Database: organized collection of related data\n- DBMS: software that manages a database\n- Table: rows and columns",
        "Business law notes": "Week 2 vocabulary\n- Database: Westlaw and LexisNexis\n- Statute: a written law passed by a legislature",
        "CS slide headings": "Lecture 5 overview\n## Database: Design principles\n- Normalization removes redundancy in tables",
        "Web design notes": "Site architecture\n- Sub-page: a page nested under a parent page\n- Breadcrumbs show the path back to the home page",
    }

    def test_clean_text_keeps_them(self):
        from services.text_processing import clean_text
        for name, text in self.CASES.items():
            out = clean_text(text)
            self.assertEqual([line for line in text.splitlines() if line.strip() and line.strip() not in out], [], name)

    def test_a_web_page_keeps_them(self):
        from services.text_processing import clean_text, html_to_text
        text = html_to_text("<h2>Week 3: Data</h2><ul><li>Database: organized collection of related data</li><li>Query: a request for data</li></ul>")
        self.assertEqual([line for line in text.splitlines() if line.strip() and line.strip() not in clean_text(text)], [])

    def test_an_import_outline_keeps_them(self):
        from services.text_processing import text_to_outline
        outline = text_to_outline(COURSE_NOTES)
        for line in COURSE_LINES:
            self.assertIn(line.split(" ", 1)[1], outline)

    def test_even_f1_guides_keep_a_definition(self):
        from services.text_processing import without_import_lines
        text = "- Database: organized collection of related data\n- Sub-page: a page nested under a parent page\n- Database: a structured collection of data."
        self.assertEqual(without_import_lines(text, f1_guide()), text)

    def test_every_other_guide_is_returned_as_it_is(self):
        from services.text_processing import without_import_lines
        for guide in course_guides():
            self.assertEqual(without_import_lines(COURSE_NOTES, guide), COURSE_NOTES, guide["external_source_id"])
            self.assertEqual(without_import_lines(F1_NOTES, guide), F1_NOTES, guide["external_source_id"])

    def test_f1_lines_go_and_everything_else_stays_byte_for_byte(self):
        from services.text_processing import without_import_lines
        notes = "## A\r\n- Sub-page: Lecture 9\r\n\n- Real point\r\n  - Database: Reading list\n"
        self.assertEqual(without_import_lines(notes, f1_guide()), "## A\r\n\n- Real point\r\n  - Database: Reading list\n")


class Consumers:
    """One test per place a guide's notes reach a model (H2). Each runs twice: the F1 guide (its lines
    gone, the rest there) and the course's own lines from every source (all there)."""

    def check(self, seen):
        """seen(guide_row) -> the text the model was given."""
        text = seen(f1_guide())
        self.assertEqual(leaks(text), [])
        for kept in F1_KEPT:
            self.assertIn(kept, text)
        for guide in course_guides():
            self.assertEqual(lost(seen({**guide, "id": GID})), [], guide["external_source_id"])


class H2EveryConsumer(Consumers, unittest.TestCase):
    def setUp(self):
        import logging
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)
        from fastapi.testclient import TestClient
        from main import app
        self.client = TestClient(app, raise_server_exceptions=False)

    def db_with(self, guide):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("study_guides").append(dict(guide))
        return db

    def test_practice(self):
        def seen(guide):
            got = {}
            with patch("routers.practice.get_user_id", return_value=USER), patch("routers.practice.get_supabase", return_value=self.db_with(guide)), \
                 patch("routers.practice.require"), patch("routers.practice.record"), patch("routers.practice.learning_guidance", return_value=""), \
                 patch("routers.practice.generate_verified_practice_set", side_effect=lambda content, guidance="": got.setdefault("c", content) and {"problems": []}):
                self.client.post("/practice", headers=H, json={"guide_id": GID})
            return got["c"]
        self.check(seen)

    def test_nclex(self):
        import routers.nclex as nx

        def seen(guide):
            got = {}
            with patch.object(nx, "get_user_id", return_value=USER), patch.object(nx, "get_supabase", return_value=self.db_with(guide)), \
                 patch.object(nx, "require"), patch.object(nx, "record", create=True), \
                 patch.object(nx, "generate_nclex_questions", side_effect=lambda content: got.setdefault("c", content) and [{"stem": "x"}]):
                response = self.client.get(f"/nclex/{GID}/generate", headers=H)
            self.assertEqual(response.status_code, 200, response.text)
            return got["c"]
        self.check(seen)

    def test_the_guide_tutor(self):
        from services import guide_tutor
        self.check(lambda guide: guide_tutor.guide_context(guide)[0])

    def test_the_guide_tutor_route_reads_where_the_guide_came_from(self):
        text = (ROOT / "backend" / "routers" / "guide_sharing.py").read_text()
        self.assertIn('select("quiz_questions,external_source_id")', text)
        from services.guide_access import GUIDE_COLUMNS
        self.assertIn("created_at", GUIDE_COLUMNS)

    def test_chat_make_practice(self):
        from routers import chat

        def seen(guide):
            got = {}
            db = self.db_with(guide)
            db.rows("folders").append({"id": "f1", "user_id": USER, "name": "Bio"})
            with patch.object(chat, "get_supabase", return_value=db), \
                 patch.object(chat, "plan_app_action", return_value={"action": "make", "kind": "practice", "guide_id": GID}), \
                 patch.object(chat, "_create_guide", side_effect=lambda user, material, folder, kind: got.setdefault("c", material.content) and chat.ChatResponse(answer="ok", guide={"id": "n"})):
                chat._app_action(USER, "make practice from Week 3", chat.Material("", {}), "Bearer t")
            return got["c"]
        self.check(seen)

    def test_the_tutor_material_for_a_guide(self):
        from routers import chat

        def seen(guide):
            with patch.object(chat, "get_supabase", return_value=self.db_with(guide)):
                return chat._load_owned_material(chat.ChatRequest(question="quiz me", content="", guide_id=GID), USER).content
        self.check(seen)

    def test_a_review_guide(self):
        from routers import plans

        def seen(guide):
            db = self.db_with({**guide, "folder_id": "f1", "source_type": "notion", "source_title": "Notion"})
            db.rows("folders").append({"id": "f1", "user_id": USER, "name": "Bio"})
            with patch("routers.plans.get_supabase", return_value=db), patch("services.library_import.get_supabase", return_value=db):
                try:
                    plans.build_review(USER, "f1", "Review", "review:x")
                except Exception:  # the build may need more tables than the fake has; the guide it filed is what matters
                    pass
            return "\n".join(row["notes"] for row in db.rows("study_guides") if row.get("source_type") == "review")
        self.check(seen)

    def test_memory_snippets(self):
        from services import memory_context

        def seen(guide):
            words = ("Glycolysis", "Krebs", "Lecture", "Reading", "imported", "Database", "Westlaw", "organized", "nested", "Design", "Lab")
            with patch.object(memory_context, "_search", side_effect=lambda db, table, *a, **k: [dict(guide, id="other")] if table == "study_guides" else []), \
                 patch.object(memory_context, "_known_well", return_value={}), patch.object(memory_context, "_snippet",
                 side_effect=lambda text, terms: (1, text)):
                found = memory_context.related_material(None, USER, GID, " ".join(words), "")
            self.assertTrue(found, "no snippet came back")
            return "\n".join(item["snippet"] for item in found if item["kind"] == "guide")
        self.check(seen)

    def test_memory_search_reads_where_the_guide_came_from(self):
        text = (ROOT / "backend" / "services" / "memory_context.py").read_text()
        self.assertIn('"id, title, notes, study_guide, external_source_id, created_at"', text)


class L5NoCallAfterTheReadGaveUp(unittest.TestCase):
    """probe5 A: four reads at once for one student, calls that hang past the deadline. Calls waiting
    for a slot give up at their read's deadline; none starts after it; the gate is empty afterwards."""

    def setUp(self):
        import rate_limit
        from services import notion_text as nt
        rate_limit.limiter.reset()
        nt.reset_gates()
        self.addCleanup(nt.reset_gates)

    def test_no_call_starts_after_its_read_gave_up(self):
        from services import notion_text as nt
        tree = {PAGE: [block("toggle", f"Q{i}", block_id=f"t{i}", children=True) for i in range(30)]}
        tree.update({f"t{i}": [block("paragraph", f"A{i}")] for i in range(30)})
        fake = SlowNotion(tree)
        lock = threading.Lock()
        state = {"now": 0, "peak": 0, "late": 0, "calls": 0}
        deadline = time.monotonic() + 0.3  # the four reads share one deadline, so "late" means late for every one

        def hang(account, user, slug, arguments):
            with lock:
                state["calls"] += 1
                state["now"] += 1
                state["peak"] = max(state["peak"], state["now"])
                state["late"] += time.monotonic() >= deadline
            time.sleep(0.05 if arguments["block_id"] == PAGE else 0.75)
            with lock:
                state["now"] -= 1
            return fake(account, user, slug, arguments)

        results = []

        def go():
            try:
                read = nt.read_page("ca", USER, PAGE, deadline=deadline)
                results.append((read.partial, read.reason))
            except HTTPException as error:
                results.append(error.status_code)

        with patch("services.composio.run", side_effect=hang):
            threads = [threading.Thread(target=go) for _ in range(4)]
            [thread.start() for thread in threads]
            [thread.join() for thread in threads]
            gave_up = time.monotonic()
            time.sleep(1.2)  # every call still in flight ends
        self.assertLess(gave_up - deadline, 0.2, "the reads returned at their deadline")
        self.assertEqual(len(results), 4)
        self.assertIn((True, "time"), results)
        self.assertEqual(state["late"], 0, state)
        self.assertLessEqual(state["peak"], 3)
        self.assertEqual(state["now"], 0)
        self.assertEqual(nt._gates, {})

    def test_a_call_waiting_for_a_slot_is_never_made_after_the_deadline(self):
        from services import notion_text as nt
        started = []
        release = threading.Event()

        def fetch(arguments):
            started.append((arguments["n"], time.monotonic()))
            release.wait(1.0)
            return {}

        deadline = time.monotonic() + 0.2
        reader = nt._Reader(fetch, deadline, 10, USER)
        holders = [threading.Thread(target=reader._fetch, args=({"n": i},)) for i in range(3)]
        [thread.start() for thread in holders]
        time.sleep(0.05)
        with self.assertRaises(nt._OutOfTime):
            reader._fetch({"n": "waiting"})  # all three slots are busy until after the deadline
        self.assertGreaterEqual(time.monotonic(), deadline)
        release.set()
        [thread.join() for thread in holders]
        self.assertEqual([n for n, _ in started], [0, 1, 2])
        with self.assertRaises(nt._OutOfTime):
            reader._fetch({"n": "late"})  # a free slot after the deadline: still no call
        self.assertEqual(len(started), 3)
        self.assertEqual(nt._gates, {})

    def test_a_read_whose_first_call_never_got_a_slot_is_a_502(self):
        from services import notion_text as nt
        release = threading.Event()
        deadline = time.monotonic() + 0.15
        busy = nt._Reader(lambda arguments: release.wait(1.0) or {}, deadline + 5, 10, USER)
        holders = [threading.Thread(target=busy._fetch, args=({},)) for _ in range(3)]
        [thread.start() for thread in holders]
        time.sleep(0.05)
        calls = []
        with patch("services.composio.run", side_effect=lambda *a: calls.append(a) or {"results": []}):
            with self.assertRaises(HTTPException) as caught:
                nt.read_page("ca", USER, PAGE, deadline=deadline)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(calls, [])
        release.set()
        [thread.join() for thread in holders]
        self.assertEqual(nt._gates, {})

    def test_an_odd_error_frees_its_slot(self):
        from services import notion_text as nt

        def boom(*a, **k):
            raise ValueError("odd")
        with patch("services.composio.run", side_effect=boom):
            for _ in range(5):
                with self.assertRaises(ValueError):
                    nt.read_page("ca", USER, PAGE)
        self.assertEqual(nt._gates, {})


class TheSql(unittest.TestCase):
    """M3, read without a database (the Postgres run is tests/notion-oneoff-sql.test.js)."""

    def test_part_2_is_held_in_a_transaction_that_rolls_back(self):
        part1, part2 = SQL.split("-- ===== PART 2", 1)
        self.assertNotIn("update ", part1.lower().replace("-- ", "--"))
        self.assertNotIn("delete", part1.lower())
        statements = [line.strip() for line in part2.splitlines()[1:] if line.strip() and not line.strip().startswith("--")]
        self.assertEqual(statements[0], "begin;")
        self.assertEqual(statements[-1], "rollback;")
        self.assertNotRegex(SQL, r"(?im)^\s*commit\s*;")
        self.assertIn("change this line to: commit;", SQL)

    def test_both_parts_use_the_same_settings_and_lines(self):
        part1, part2 = SQL.split("-- ===== PART 2", 1)
        settings = re.findall(r"with settings as \((.*?)\n\),", SQL, re.S)
        self.assertEqual(len(settings), 2)
        self.assertEqual(settings[0], settings[1])
        rule = lambda part: re.search(r"candidates as \((.*?)\n\)", part, re.S).group(1)  # noqa: E731
        self.assertEqual(rule(part1), rule(part2))
        guides = lambda part: re.search(r"f1_guides as \((.*?)\n\), lines", part, re.S).group(1)  # noqa: E731
        self.assertEqual(guides(part1), guides(part2))
        self.assertIn("external_source_id like 'notion:%'", guides(part1))


if __name__ == "__main__":
    unittest.main()
