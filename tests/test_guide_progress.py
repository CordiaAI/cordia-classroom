"""Studying someone else's guide with your own progress, and progress that follows ideas through
edits (social plan, Stage 4): routers/study.py, services/guide_versions.py, services/viewer_study.py,
the quiz routes' studier path and guides.update_guide."""
from pathlib import Path
from types import SimpleNamespace
import copy
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import guide_versions, ideas  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"   # the author
BEN = "bbbbbbbb-0000-4000-8000-000000000002"   # a classmate studying Ana's guide
CAT = "cccccccc-0000-4000-8000-000000000003"   # another student studying it
DAN = "dddddddd-0000-4000-8000-000000000004"   # never studied it
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN}
CLASS = "c0000000-0000-4000-8000-000000000001"
BLOCKED_CLASS = "c0000000-0000-4000-8000-000000000002"
FOLDER = "f0000000-0000-4000-8000-000000000001"
BLOCKED_FOLDER = "f0000000-0000-4000-8000-000000000002"
GUIDE = "10000000-0000-4000-8000-000000000001"
MODULES = ("study", "quiz", "guides", "guide_sharing")

PAIRS = [
    ("What is lead time?", "The wait between placing an order and receiving it"),
    ("What is safety stock?", "Extra inventory kept to cover uncertain demand"),
    ("What is a bullwhip effect?", "Small demand changes growing larger up the supply chain"),
]


def text(pairs):
    return "\n".join(f"Q{i + 1}: {q}\nA{i + 1}: {a}" for i, (q, a) in enumerate(pairs))


def cards(pairs):
    return [{"front": q, "back": a} for q, a in pairs]


class DB(FakeDB):
    """FakeDB plus merge_guide_progress (as in the migration) and usage recording."""

    def rpc(self, name, params):
        db = self

        class Call:
            def execute(self):
                if name != "merge_guide_progress":
                    return SimpleNamespace(data=None)
                rows = db.rows("guide_progress")
                row = next((r for r in rows if r["user_id"] == params["viewer"] and r["guide_id"] == params["guide"]), None)
                if row is None:
                    row = {"user_id": params["viewer"], "guide_id": params["guide"], "version_seen": params.get("version") or 1,
                           "dismissed_version": None, "progress": {}, "test_date": None, "test_format": None, "updated_at": "2026-11-06T00:00:00Z"}
                    rows.append(row)
                for key, value in (params.get("patch") or {}).items():
                    merged = {**(row["progress"].get(key) or {}), **value}
                    row["progress"][key] = {k: v for k, v in merged.items() if v is not None}
                if params.get("test_date") is not None:
                    row["test_date"] = params["test_date"].get("value")
                if params.get("test_format") is not None and params["test_format"].get("value") in ("mc", "short", "essay", "mix", "unsure"):
                    row["test_format"] = params["test_format"]["value"]
                return SimpleNamespace(data=copy.deepcopy(row["progress"]))
        return Call()


class GuideProgressTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = DB()
        self.db.rows("classes").extend([{"id": CLASS, "course_code_normalized": "MGT 300", "sharing_blocked": False},
                                        {"id": BLOCKED_CLASS, "course_code_normalized": "FILM 201", "sharing_blocked": True}])
        self.db.rows("folders").extend([{"id": FOLDER, "user_id": ANA, "class_id": CLASS},
                                        {"id": BLOCKED_FOLDER, "user_id": ANA, "class_id": BLOCKED_CLASS}])
        self.db.rows("study_guides").append({
            "id": GUIDE, "user_id": ANA, "title": "Supply chains", "notes": "# Supply chains", "study_guide": text(PAIRS),
            "flashcards": cards(PAIRS), "quiz_questions": None, "flashcard_progress": {"schedule": {"0": {"box": 3, "due": "2026-11-20"}}, "known": [0]},
            "folder_id": FOLDER, "visibility": "public", "attribution": "named", "version": 1, "review_status": "ok", "hold_reason": None,
            "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"})

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        self.require, self.record = MagicMock(), MagicMock()
        self.patches = [patch(f"routers.{m}.get_user_id", side_effect=who) for m in MODULES]
        self.patches += [patch(f"routers.{m}.get_supabase", return_value=self.db) for m in MODULES]
        self.patches += [patch("routers.quiz.start_quiz_warmup"), patch("routers.guides.start_quiz_warmup"),
                         patch("routers.quiz.require", self.require), patch("routers.quiz.record", self.record),
                         patch("routers.quiz.remaining", return_value=0), patch("routers.quiz.plan_for", return_value="free"),
                         patch("routers.quiz.subscription_row", return_value=None), patch("routers.stats._update_streak"),
                         patch("routers.guides.on_guide_changed"),
                         patch.dict(os.environ, {"PER_VIEWER_PROGRESS": "true"})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def call(self, method, who, path, **kw):
        return getattr(self.client, method)(path, headers={"Authorization": f"Bearer {who}"}, **kw)

    def guide_row(self):
        return next(g for g in self.db.rows("study_guides") if g["id"] == GUIDE)

    def studied(self, who):
        response = self.call("get", who, f"/guides/{GUIDE}/study")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save(self, who, version, cards_=None, levels=None, **learn):
        body = {"version": version, "cards": cards_}
        if levels is not None or learn:
            body["learn"] = {"levels": levels or {}, **learn}
        response = self.call("post", who, f"/guides/{GUIDE}/progress", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["flashcard_progress"]

    def level(self, question, level):
        return {"l": level, "at": "2026-11-06", "q": ideas.fingerprint48(question)}

    def edit(self, pairs, **extra):
        response = self.call("patch", "ana", f"/guides/{GUIDE}", json={"title": "Supply chains", "study_guide": text(pairs), "flashcards": cards(pairs), **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["guide"]

    # Studying someone else's guide ------------------------------------------------------------------
    def test_off_without_the_flag(self):
        with patch.dict(os.environ, {"PER_VIEWER_PROGRESS": ""}):
            self.assertEqual(self.call("get", "ben", f"/guides/{GUIDE}/study").status_code, 404)
            self.assertEqual(self.call("post", "ben", f"/quiz/{GUIDE}/session", json={"types": ["mc"]}).status_code, 404)

    def test_two_students_keep_their_own_progress_and_never_touch_the_authors(self):
        author_before = copy.deepcopy(self.guide_row())
        first = self.studied("ben")["guide"]
        self.assertEqual(len(first["flashcards"]), 3)
        self.assertTrue(all(ideas.valid_id(c["idea_id"]) for c in first["flashcards"]))
        self.assertEqual(first["flashcard_progress"]["schedule"], {}, "a new student starts fresh, not with the author's boxes")
        self.assertEqual(first["viewer"]["version"], 1)
        self.assertNotIn("user_id", first)
        self.assertNotIn("folder_id", first)
        questions = first["quiz_questions"]
        ben = self.save("ben", 1, {"0": {"box": 2, "due": "2026-11-09", "known": True}}, {"1": self.level(questions[1]["question"], 2)},
                        test_date="2026-12-01", test_format="essay")
        self.assertEqual(ben["schedule"], {"0": {"box": 2, "due": "2026-11-09"}})
        self.assertEqual(ben["learn"]["levels"]["1"]["l"], 2)
        self.studied("cat")
        cat = self.save("cat", 1, {"2": {"box": 1, "due": "2026-11-07", "known": False}})
        self.assertEqual((cat["schedule"], cat["unknown"]), ({"2": {"box": 1, "due": "2026-11-07"}}, [2]))
        again = self.studied("ben")["guide"]["flashcard_progress"]
        self.assertEqual((again["known"], again["learn"]["test_date"], again["learn"]["test_format"]), ([0], "2026-12-01", "essay"))
        self.assertNotIn("2", again["schedule"], "Cat's answers never show up in Ben's progress")
        self.assertEqual(self.guide_row(), author_before, "the author's guide row is never written by a studier")
        self.assertEqual({r["user_id"] for r in self.db.rows("guide_progress")}, {BEN, CAT})

    def test_the_owner_uses_the_usual_routes(self):
        self.assertEqual(self.call("get", "ana", f"/guides/{GUIDE}/study").status_code, 400)
        self.assertEqual(self.call("post", "ana", f"/guides/{GUIDE}/progress", json={"version": 1}).status_code, 400)

    def test_quiz_on_someone_elses_guide_is_stable_and_charged_and_recorded_to_the_studier(self):
        self.studied("ben")
        one = self.call("post", "ben", f"/quiz/{GUIDE}/session", json={"types": ["mc"]}).json()
        two = self.call("post", "ben", f"/quiz/{GUIDE}/session", json={"types": ["mc"]}).json()
        self.assertEqual(one["questions"], two["questions"], "the same version always asks the same questions")
        self.assertIsNone(self.guide_row()["quiz_questions"], "nothing is saved to the author's guide")
        with patch("routers.quiz.grade_written_answer", return_value={"credit": 1.0, "explanation": "Yes"}):
            graded = self.call("post", "ben", f"/quiz/{GUIDE}/grade", json={"concept": 0, "answer": "The wait"})
        self.assertEqual(graded.status_code, 200, graded.text)
        self.require.assert_any_call(BEN, "light")
        self.record.assert_any_call(BEN, "light")
        self.assertNotIn(ANA, [c.args[0] for c in self.require.call_args_list], "the author's allowance is never used")
        right = one["questions"][0]["options"][one["questions"][0]["correct_index"]]
        submitted = self.call("post", "ben", f"/quiz/{GUIDE}/submit", json={"attempts": [{"concept": 0, "type": "mc", "response": right}]})
        self.assertEqual(submitted.json()["score"], 100)
        self.assertEqual([(a["user_id"], a["guide_id"]) for a in self.db.rows("quiz_attempts")], [(BEN, GUIDE)])
        self.assertEqual([s["user_id"] for s in self.db.rows("study_sessions")], [BEN])

    def test_a_stranger_to_a_private_guide_gets_the_usual_404(self):
        self.guide_row()["visibility"] = "private"
        self.assertEqual(self.call("get", "dan", f"/guides/{GUIDE}/study").status_code, 404)
        self.assertEqual(self.call("post", "dan", f"/quiz/{GUIDE}/session", json={"types": ["mc"]}).status_code, 404)

    # The author's edits -----------------------------------------------------------------------------
    def edited_pairs(self):
        return [
            ("What is lead time?", "The wait between placing an order and receiving it."),        # punctuation only
            ("What is safety stock?", "Inventory sold below cost to clear old products"),           # really changed
            ("What is a reorder point?", "The stock level that triggers a new order"),             # new
        ]                                                                                          # bullwhip removed

    def ben_studies_everything(self):
        guide = self.studied("ben")["guide"]
        questions = guide["quiz_questions"]
        self.save("ben", 1, {str(i): {"box": 3, "due": "2026-11-20", "known": True} for i in range(3)},
                  {str(i): self.level(q["question"], 3) for i, q in enumerate(questions)})
        return guide

    def test_update_available_stay_and_accept(self):
        before = self.ben_studies_everything()
        self.edit(self.edited_pairs())
        self.assertEqual(self.guide_row()["version"], 2)
        view = self.studied("ben")["guide"]
        self.assertEqual(view["viewer"]["version"], 1, "Ben keeps studying the version he started on")
        self.assertTrue(view["viewer"]["update_available"])
        self.assertEqual(view["viewer"]["changes"], {"added": 1, "changed": 1, "removed": 1})
        self.assertEqual([c["front"] for c in view["flashcards"]], [c["front"] for c in before["flashcards"]])
        changes = self.call("get", "ben", f"/guides/{GUIDE}/changes").json()
        self.assertEqual(changes["changed"][0]["before"]["answer"], PAIRS[1][1])
        self.assertEqual(changes["changed"][0]["answer"], "Inventory sold below cost to clear old products")
        self.assertEqual([i["question"] for i in changes["removed"]], ["What is a bullwhip effect?"])
        self.assertEqual([i["question"] for i in changes["added"]], ["What is a reorder point?"])
        # Stay on v1: the notice goes quiet until the next change.
        self.assertEqual(self.call("post", "ben", f"/guides/{GUIDE}/stay").status_code, 200)
        stayed = self.studied("ben")["guide"]["viewer"]
        self.assertEqual((stayed["version"], stayed["update_available"], stayed["stayed"]), (1, False, True))
        # Accept: unchanged keeps everything, changed steps back, removed is archived, new starts fresh.
        self.assertEqual(self.call("post", "ben", f"/guides/{GUIDE}/accept-update").json()["version"], 2)
        now = self.studied("ben")["guide"]
        self.assertEqual(now["viewer"]["version"], 2)
        self.assertFalse(now["viewer"]["update_available"])
        progress = now["flashcard_progress"]
        self.assertEqual(progress["schedule"]["0"]["box"], 3)
        self.assertEqual(progress["learn"]["levels"]["0"]["l"], 3)
        self.assertEqual(progress["schedule"]["1"]["box"], 0, "a changed idea's card starts again")
        self.assertEqual(progress["learn"]["levels"]["1"]["l"], 2, "a changed idea drops one Learn level")
        self.assertNotIn("2", progress["schedule"], "a new idea starts fresh")
        row = next(r for r in self.db.rows("guide_progress") if r["user_id"] == BEN)
        archived = [e for e in row["progress"].values() if e.get("archived")]
        self.assertEqual(len(archived), 1, "the removed idea is archived, not deleted")

    def test_a_typo_or_title_edit_moves_students_along_silently(self):
        self.ben_studies_everything()
        typo = [("What is lead time?", "The wait between placing an order and recieving it")] + PAIRS[1:]
        self.edit(typo, title="Supply chains, week 2")
        view = self.studied("ben")["guide"]
        self.assertEqual((view["viewer"]["version"], view["viewer"]["update_available"]), (2, False))
        self.assertEqual(view["flashcard_progress"]["learn"]["levels"]["0"]["l"], 3)

    def test_every_version_is_hidden_with_the_guide_and_progress_is_kept(self):
        self.ben_studies_everything()
        self.edit(self.edited_pairs())
        self.call("post", "ben", f"/guides/{GUIDE}/stay")
        cases = [
            ({"visibility": "private"}, "The author made this guide private."),
            ({"review_status": "held", "hold_reason": "Copyright report"}, "This guide is being reviewed. If it's cleared, you can study it again."),
            ({"review_status": "hidden"}, "This guide was removed."),
            ({"folder_id": BLOCKED_FOLDER}, "Sharing is turned off for this guide's class."),
        ]
        normal = {"visibility": "public", "review_status": "ok", "hold_reason": None, "folder_id": FOLDER}
        for change, reason in cases:
            with self.subTest(change=change):
                self.guide_row().update({**normal, **change})
                gone = self.call("get", "ben", f"/guides/{GUIDE}/study").json()
                self.assertEqual(gone, {"unavailable": reason, "title": "Supply chains"})
                self.assertEqual(self.call("post", "ben", f"/quiz/{GUIDE}/session", json={"types": ["mc"]}).status_code, 404)
                self.assertEqual(self.call("post", "ben", f"/guides/{GUIDE}/progress", json={"version": 1}).status_code, 404)
                self.assertEqual(self.call("get", "dan", f"/guides/{GUIDE}/study").status_code, 404, "no reason for someone who never studied it")
        self.db.rows("user_blocks").append({"blocker_id": ANA, "blocked_id": BEN})
        self.guide_row().update(normal)
        self.assertEqual(self.call("get", "ben", f"/guides/{GUIDE}/study").json()["unavailable"], "This guide isn't available to you.")
        self.db.rows("user_blocks").clear()
        back = self.studied("ben")["guide"]
        self.assertEqual((back["viewer"]["version"], back["flashcard_progress"]["schedule"]["0"]["box"]), (1, 3), "progress kept while it was hidden")

    def test_old_versions_are_pruned_once_no_one_is_on_them(self):
        self.ben_studies_everything()
        self.edit(self.edited_pairs())
        self.assertEqual([v["version"] for v in self.db.rows("guide_versions")], [1], "v1 is kept: Ben is on it")
        self.call("post", "ben", f"/guides/{GUIDE}/accept-update")
        self.assertEqual(self.db.rows("guide_versions"), [], "nobody is on v1 any more")

    def test_the_authors_own_progress_follows_their_edit(self):
        row = self.guide_row()
        quiz = [{"question": q, "options": [a, "x", "y", "z"], "correct_index": 0} for q, a in PAIRS]
        row["quiz_questions"] = quiz
        row["flashcard_progress"] = {
            "schedule": {str(i): {"box": 4, "due": "2026-11-30"} for i in range(3)}, "known": [0, 1, 2], "unknown": [],
            "learn": {"levels": {str(i): self.level(q, 3) for i, (q, _) in enumerate(PAIRS)}, "test_date": "2026-12-01"},
            "last_studied": "2026-11-05T00:00:00Z"}
        # A new idea at the top shifts every position by one.
        self.edit([("What is a reorder point?", "The stock level that triggers a new order")] + self.edited_pairs()[:2])
        progress = self.guide_row()["flashcard_progress"]
        self.assertEqual(progress["schedule"]["1"], {"box": 4, "due": "2026-11-30"}, "lead time moved from 0 to 1 and kept its box")
        self.assertEqual(progress["schedule"]["2"]["box"], 0, "safety stock changed: back to the first box")
        self.assertNotIn("0", progress["schedule"], "the new idea starts fresh")
        self.assertEqual(progress["learn"]["levels"]["1"]["l"], 3)
        self.assertEqual(progress["learn"]["levels"]["2"]["l"], 2)
        self.assertEqual(progress["learn"]["test_date"], "2026-12-01")
        self.assertEqual(len(progress["archived"]), 1, "bullwhip was removed: archived, not lost")
        new_quiz = self.guide_row()["quiz_questions"]
        self.assertEqual([q["question"] for q in new_quiz], ["What is a reorder point?", "What is lead time?", "What is safety stock?"])
        self.assertIs(new_quiz[1], new_quiz[1])
        self.assertEqual(new_quiz[1]["options"], [PAIRS[0][1], "x", "y", "z"], "an unchanged question keeps its wrong answers")
        self.assertIn("Inventory sold below cost to clear old products", new_quiz[2]["options"], "a changed one gets the new answer")

    def test_copy_carries_the_studiers_own_progress(self):
        guide = self.ben_studies_everything()
        made = self.call("post", "ben", f"/guides/{GUIDE}/copy", json={"carry_progress": True})
        self.assertEqual(made.status_code, 200, made.text)
        copy_row = next(g for g in self.db.rows("study_guides") if g["id"] == made.json()["guide_id"])
        self.assertEqual([c["idea_id"] for c in copy_row["flashcards"]], [c["idea_id"] for c in guide["flashcards"]])
        self.assertEqual(copy_row["flashcard_progress"]["schedule"]["2"]["box"], 3)
        self.assertNotEqual(copy_row["flashcard_progress"].get("schedule"), self.guide_row()["flashcard_progress"].get("schedule"),
                            "Ben's progress, not the author's")


class IdeaProgressUnitTests(unittest.TestCase):
    def test_ids_without_a_saved_one_are_the_same_on_every_read(self):
        first = ideas.ensure_ids(cards(PAIRS), None)[0]
        second = ideas.ensure_ids(cards(PAIRS), None)[0]
        self.assertEqual([c["idea_id"] for c in first], [c["idea_id"] for c in second])

    def test_a_level_saved_at_the_wrong_position_is_matched_by_its_question(self):
        questions = [{"question": q, "idea_id": f"idea00000{i}"} for i, (q, _) in enumerate(PAIRS)]
        patch_ = guide_versions.patch_from(None, {"0": {"l": 2, "q": ideas.fingerprint48(PAIRS[2][0]), "at": "2026-11-06"},
                                                  "1": {"l": 1, "q": "nothing like any question"}}, [], questions)
        self.assertEqual(list(patch_), ["idea000002"])

    def test_free_questions_for_a_version_are_repeatable(self):
        content = {"version": 3, "quiz": None, "qa": ideas.ensure_ids([{"question": q, "answer": a} for q, a in PAIRS])[0]}
        self.assertEqual(guide_versions.questions_for(content, GUIDE), guide_versions.questions_for(content, GUIDE))
        self.assertTrue(all(q.get("idea_id") for q in guide_versions.questions_for(content, GUIDE)))


if __name__ == "__main__":
    unittest.main()
