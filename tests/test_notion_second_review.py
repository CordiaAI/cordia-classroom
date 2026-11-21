"""F1b second review (#285): the reviewer's probes (probe3.py, probe4.py) as tests, and the findings
behind them. A gateway's HTML error page is never a 500; a Library import keeps every paragraph and
short bullet or says it didn't; the import's own lines stay out of cards and quizzes; two reads at
once stay inside three calls in flight. (Which import lines stay out, and where, is in
test_notion_third_review.py: round 3 scoped them to the guides the first Notion import filed.) The real Notion and Composio APIs are never called."""
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fastapi import HTTPException  # noqa: E402

from test_notion_review import (  # noqa: E402
    Base, FOLDER, PAGE, USER, SlowNotion, TutorNeverFails, block)


class FakeResponse:
    """What requests hands back: a status, the raw body, and json() that raises on a non-JSON body."""

    def __init__(self, status, content):
        self.status_code, self.content, self.ok = status, content, status < 400
        self.text = content.decode()

    def json(self):
        import json
        return json.loads(self.content)


HTML_504 = FakeResponse(504, b"<html><body><h1>504 Gateway Time-out</h1></body></html>")
HTML_502 = FakeResponse(502, b"<!DOCTYPE html><html><body>Bad gateway</body></html>")
HTML_200 = FakeResponse(200, b"<html><body>Maintenance</body></html>")
JSON_LIST = FakeResponse(200, b"[1, 2, 3]")


class HtmlGatewayErrors(Base):
    """H1: Composio (or its gateway) answering with HTML is the app not answering: a 502, never a 500."""

    def test_composio_run_turns_a_non_json_body_into_a_502_whatever_the_status(self):
        from services import composio
        for response in (HTML_504, HTML_502, HTML_200, JSON_LIST):
            with patch("services.composio._request", return_value=response):
                with self.assertRaises(HTTPException) as raised:
                    composio.run("ca", USER, "NOTION_FETCH_BLOCK_CONTENTS", {"block_id": PAGE})
            self.assertEqual(raised.exception.status_code, 502, response.content)
            self.assertIn("didn't respond", raised.exception.detail)

    def test_an_html_429_is_still_a_429_so_the_reader_can_wait(self):
        from services import composio
        with patch("services.composio._request", return_value=FakeResponse(429, b"<html>Too many requests</html>")):
            with self.assertRaises(HTTPException) as raised:
                composio.run("ca", USER, "X", {})
        self.assertEqual(raised.exception.status_code, 429)

    def test_the_other_composio_calls_survive_an_html_body_too(self):
        from services import composio
        with patch("services.composio._request", return_value=HTML_200), patch("services.composio.configured", return_value=True):
            self.assertEqual(composio.active_accounts(USER), {})
        with patch("services.composio._request", return_value=HTML_504), patch("services.composio._auth_config", return_value="ac_1"):
            with self.assertRaises(HTTPException) as raised:
                composio.start_link(USER, "notion", "https://example.test/back")
        self.assertEqual(raised.exception.status_code, 502)

    def test_an_import_whose_gateway_answers_html_is_a_502_with_a_plain_message(self):
        for response in (HTML_504, HTML_502):
            with patch("services.composio._request", return_value=response):
                answer = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "x"})
            self.assertEqual(answer.status_code, 502, answer.text)
            self.assertIn("didn't respond", answer.json()["detail"])

    def test_a_later_listing_that_answers_html_keeps_what_was_read(self):
        import json
        calls = {"n": 0}

        def mixed(method, path, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                body = {"successful": True, "data": {"results": [block("paragraph", f"P{i}") for i in range(100)], "has_more": True, "next_cursor": "100"}}
                return FakeResponse(200, json.dumps(body).encode())
            return HTML_504

        with patch("services.composio._request", side_effect=mixed):
            answer = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "x"})
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertTrue(answer.json()["partial"])
        self.assertEqual(len(answer.json()["text"].splitlines()), 100)


class TutorSurvivesHtml(Base):
    material = TutorNeverFails.material
    search = staticmethod(TutorNeverFails.search)

    def test_a_tutor_message_with_a_notion_read_never_fails_on_html(self):
        from services import composio
        with patch("services.composio._request", return_value=HTML_504):
            found = self.material(composio.run)
        self.assertIn("slow to answer", found["problem"])

    def test_whatever_the_read_raises_the_message_is_still_answered(self):
        for error in (ValueError("not json"), KeyError("results"), TypeError("nope")):
            def run(account, user, slug, arguments, error=error):
                raise error
            found = self.material(run)
            self.assertIn("slow to answer", found["problem"], error)

    def test_the_reply_is_a_chat_answer_not_an_exception(self):
        from routers import chat
        problem = {"connector": "notion", "name": "Notion", "problem": "Notion was slow to answer. Ask again in a minute."}
        with patch.object(chat.connectors, "tutor_material", return_value=problem):
            body = chat.ChatRequest(question="quiz me on my notion page", content="")
            answer = chat._reply(body, USER, "quiz me on my notion page", chat.Material(content=""), None, None, None, "Bearer t")
        self.assertEqual(answer.answer, problem["problem"])


PROBE4_PARAGRAPH = "Glycolysis " + " ".join(f"step{i} converts substrate {i} into product {i}." for i in range(60))


class LibraryKeepsEverything(Base):
    """H2: no point is sliced at 600 characters, no short bullet is dropped, and a dropped line says so."""

    def setUp(self):
        super().setUp()
        from fake_supabase import FakeDB
        self.db = FakeDB()
        self.db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        for p in [patch("routers.drive.get_supabase", return_value=self.db), patch("services.library_import.get_supabase", return_value=self.db),
                  patch("services.library_import.guide_title", return_value="Notes")]:
            p.start()
            self.addCleanup(p.stop)

    def file(self, blocks):
        response = self.post(SlowNotion({PAGE: blocks}), "library", folder_id=FOLDER)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), self.db.rows("study_guides")[0]["notes"]

    def test_probe4_paragraph_comes_in_whole_as_several_points(self):
        self.assertGreater(len(PROBE4_PARAGRAPH), 2700)
        body, notes = self.file([block("heading_1", "Week 3"), block("paragraph", PROBE4_PARAGRAPH)])
        points = [line[2:] for line in notes.splitlines() if line.startswith("- ")]
        self.assertGreater(len(points), 4)
        self.assertTrue(all(len(point) <= 600 for point in points))
        self.assertEqual(" ".join(points), PROBE4_PARAGRAPH)  # every sentence, in order, nothing cut
        self.assertFalse(body["partial"], body)

    def test_short_bullets_na_and_k_plus_are_kept(self):
        body, notes = self.file([block("heading_1", "Ions"), block("bulleted_list_item", "Na"), block("bulleted_list_item", "K+"),
                                 block("bulleted_list_item", "pH 7"), block("bulleted_list_item", "Pyruvate goes to the mitochondria")])
        lines = notes.splitlines()
        for kept in ("- Na", "- K+", "- pH 7"):
            self.assertIn(kept, lines)
        self.assertFalse(body["partial"], body)

    def test_a_short_line_that_is_dropped_sets_partial_and_says_so(self):
        body, notes = self.file([block("heading_1", "Ions"), block("paragraph", "Na"), block("paragraph", "Sodium moves into the cell")])
        self.assertNotIn("Na\n", notes + "\n")
        self.assertTrue(body["partial"])
        self.assertIn("1 very short line", body["note"])

    def test_outline_from_text_reports_a_dropped_line_as_a_cut(self):
        from services.text_processing import build_outline, outline_from_text
        self.assertTrue(outline_from_text("Sodium moves into the cell\nNa")[1])
        self.assertEqual(build_outline("Sodium moves into the cell\nNa").dropped, 1)
        self.assertFalse(outline_from_text("Sodium moves into the cell\n- Na\n- K+")[1])

    def test_one_sentence_over_600_characters_is_split_at_a_space_not_cut(self):
        from services.text_processing import text_to_outline
        sentence = " ".join(f"word{i}" for i in range(300))  # no sentence end, about 2,000 characters
        points = [line[2:] for line in text_to_outline(sentence).splitlines()]
        self.assertTrue(all(len(point) <= 600 for point in points))
        self.assertEqual(" ".join(points), sentence)

    def test_a_long_heading_keeps_its_rest_as_points(self):
        from services.text_processing import text_to_outline
        heading = "# " + " ".join(f"term{i}" for i in range(60))
        outline = text_to_outline(heading + "\n- A point under it")
        self.assertIn("term59", outline)
        self.assertTrue(outline.splitlines()[0].startswith("## term0"))

    def test_slides_keep_their_long_lines_too(self):
        from services.text_processing import text_to_outline
        long_line = " ".join(f"Sentence {i} states a fact about slide material." for i in range(40))
        slides = f"--- Slide 1 ---\nCell biology\n{long_line}\nShort bullet here\n--- Slide 2 ---\nMembranes\nLipids form a bilayer."
        outline = text_to_outline(slides)
        self.assertIn("Sentence 39 states a fact", outline)
        self.assertTrue(all(len(line) <= 602 for line in outline.splitlines() if line.startswith("- ")))


class TheOneOffScript(unittest.TestCase):
    """M3: the clean of already-filed guides is a script for Jude, not something this code runs. What
    it removes, and that it agrees with the app, is tested on Postgres in tests/notion-oneoff-sql.test.js
    and in test_notion_third_review.py."""

    SCRIPT = ROOT / "supabase" / "oneoff" / "20261119_clean_notion_import_lines.sql"

    def test_it_is_marked_not_run_and_lists_before_it_changes(self):
        text = self.SCRIPT.read_text()
        self.assertEqual(text.splitlines()[0], "-- NOT RUN: for Jude to review and run")
        self.assertLess(text.index("line_to_remove"), text.index("update public.study_guides"))
        self.assertIn("external_source_id like 'notion:%'", text)

    def test_nothing_in_the_code_runs_it(self):
        for path in list((ROOT / "backend").rglob("*.py")) + list((ROOT / "scripts").rglob("*")):
            if path.is_file():
                try:
                    self.assertNotIn("oneoff", path.read_text(), path)
                except UnicodeDecodeError:
                    pass


class AtMostThreeCallsPerStudent(Base):
    """L4: the limit of three Notion calls in flight is per student, across reads, not per read."""

    def tree(self):
        tree = {PAGE: [block("toggle", f"Q{i}", block_id=f"t{i}", children=True) for i in range(60)]}
        tree.update({f"t{i}": [block("paragraph", f"A{i}")] for i in range(60)})
        return tree

    def test_two_reads_at_once_never_have_more_than_three_calls_in_flight(self):
        from services import notion_text as nt
        fake = SlowNotion(self.tree(), delay=0.03)
        results = []
        with patch("services.composio.run", side_effect=fake):
            threads = [threading.Thread(target=lambda: results.append(nt.read_page("ca", USER, PAGE))) for _ in range(2)]
            [thread.start() for thread in threads]
            [thread.join() for thread in threads]
        self.assertEqual(fake.calls, 122)
        self.assertGreater(fake.peak, 1)
        self.assertLessEqual(fake.peak, 3, fake.peak)
        self.assertTrue(all(not result.partial for result in results))
        self.assertEqual(nt._gates, {})  # nothing is left behind

    def test_another_student_is_not_held_up_by_it(self):
        from services import notion_text as nt
        fake = SlowNotion(self.tree(), delay=0.03)
        with patch("services.composio.run", side_effect=fake):
            threads = [threading.Thread(target=lambda user=user: nt.read_page("ca", user, PAGE)) for user in (USER, "99999999-2222-4333-8444-555555555555")]
            [thread.start() for thread in threads]
            [thread.join() for thread in threads]
        self.assertLessEqual(fake.peak, 6)
        self.assertGreater(fake.peak, 3)


if __name__ == "__main__":
    unittest.main()
