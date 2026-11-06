"""Merging duplicate sets (services/guide_merge.py, services/guide_duplicates.py, routes in routers/guides.py)."""

from pathlib import Path
from unittest.mock import patch
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import guide_duplicates, guide_merge, guide_versions, ideas  # noqa: E402

USER = "aaaaaaaa-0000-4000-8000-000000000001"
OTHER_USER = "aaaaaaaa-0000-4000-8000-000000000002"
A = "11111111-0000-4000-8000-00000000000a"
B = "11111111-0000-4000-8000-00000000000b"
C = "11111111-0000-4000-8000-00000000000c"
H = {"Authorization": "Bearer t"}


def card(front, back):
    return {"front": front, "back": back}


def guide(gid, title, cards, qa=(), notes="", progress=None, **extra):
    text = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a) in enumerate(qa, 1))
    return {"id": gid, "user_id": USER, "title": title, "notes": notes, "study_guide": text, "flashcards": list(cards),
            "quiz_questions": None, "flashcard_progress": progress or {}, "nclex_questions": None, "version": 1,
            "visibility": "private", "linked_set_id": None, "folder_id": None, "created_at": extra.pop("created_at", "2026-10-01T00:00:00+00:00"),
            **extra}


class BeforeMigration(FakeDB):
    def table(self, name):
        if name in ("guide_merge_backups", "guide_duplicate_checks"):
            raise RuntimeError(f'relation "public.{name}" does not exist')
        return super().table(name)


class MergeContentTests(unittest.TestCase):
    def test_new_ideas_are_added_and_shared_ones_kept_once(self):
        keep = guide(A, "Cells", [card("What is the powerhouse of the cell?", "Mitochondria"), card("What does DNA stand for?", "Deoxyribonucleic acid")])
        other = guide(B, "Cells lecture", [card("What is the powerhouse of the cell", "The mitochondria"), card("What is osmosis?", "Water moving across a membrane")])
        plan = guide_merge.merge_content(keep, other)
        fronts = [c["front"] for c in plan["update"]["flashcards"]]
        self.assertEqual(fronts, ["What is the powerhouse of the cell?", "What does DNA stand for?", "What is osmosis?"])
        self.assertEqual((plan["added_cards"], plan["shared"]), (1, 1))
        ids = [c["idea_id"] for c in plan["update"]["flashcards"]]
        self.assertEqual(len(set(ids)), 3, "every card keeps its own idea id")

    def test_progress_follows_each_idea_and_keeps_the_stronger(self):
        keep = guide(A, "Cells", [card("Powerhouse of the cell?", "Mitochondria"), card("DNA stands for?", "Deoxyribonucleic acid")],
                     progress={"schedule": {"0": {"box": 1, "due": "2026-11-01"}}, "known": [1]})
        other = guide(B, "Cells 2", [card("Osmosis is?", "Water across a membrane"), card("Powerhouse of the cell?", "Mitochondria")],
                      progress={"schedule": {"0": {"box": 3, "due": "2026-11-09"}, "1": {"box": 4, "due": "2026-11-20"}}})
        update = guide_merge.merge_content(keep, other)["update"]
        schedule = update["flashcard_progress"]["schedule"]
        self.assertEqual(schedule["0"]["box"], 4, "the shared idea keeps the stronger box (B's 4 over A's 1)")
        self.assertEqual(schedule["2"]["box"], 3, "B's osmosis card brings its progress to its new place")
        self.assertEqual(update["flashcard_progress"]["known"], [1])

    def test_qa_pairs_and_notes_are_merged(self):
        keep = guide(A, "Rome", [], qa=[("When did Rome fall?", "476 CE")], notes="## Empire\n- point one")
        other = guide(B, "Rome reading", [], qa=[("When did Rome fall", "In 476"), ("Who was the first emperor?", "Augustus")], notes="- point two")
        plan = guide_merge.merge_content(keep, other)
        self.assertEqual(plan["added_questions"], 1)
        self.assertIn("Q2: Who was the first emperor?", plan["update"]["study_guide"])
        self.assertNotIn("In 476", plan["update"]["study_guide"])
        self.assertEqual(plan["update"]["notes"], "## Empire\n- point one\n\n## From Rome reading\n- point two")

    def test_a_saved_quiz_gets_questions_for_the_added_pairs(self):
        keep = guide(A, "Rome", [], qa=[("When did Rome fall?", "476 CE"), ("Capital of Rome?", "Rome")])
        live = guide_versions.live_content(keep)
        keep["quiz_questions"] = guide_versions.questions_for(live, A)
        other = guide(B, "Rome 2", [], qa=[("Who was the first emperor?", "Augustus"), ("Who crossed the Rubicon?", "Julius Caesar")])
        before = len(keep["quiz_questions"])
        quiz = guide_merge.merge_content(keep, other)["update"]["quiz_questions"]
        self.assertEqual(quiz[:before], keep["quiz_questions"], "the saved questions stay as they were")
        self.assertEqual({ideas.normalize(q["question"]) for q in quiz[before:]}, {"who was the first emperor", "who crossed the rubicon"})

    def test_caps_hold(self):
        keep = guide(A, "Big", [], qa=[(f"Question number {i}?", f"Answer {i}") for i in range(guide_versions.MAX_QUESTIONS)])
        other = guide(B, "More", [], qa=[("A brand new question?", "Yes")])
        plan = guide_merge.merge_content(keep, other)
        self.assertEqual((plan["added_questions"], plan["skipped"]), (0, 1))


class MergeRouteTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.patches = [patch("routers.guides.get_user_id", return_value=USER), patch("routers.guides.get_supabase", side_effect=lambda: self.db)]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)
        self.db.rows("study_guides").extend([
            guide(A, "Cells", [card("Powerhouse of the cell?", "Mitochondria")]),
            guide(B, "Cells lecture", [card("Osmosis is?", "Water across a membrane")], notes="- B note"),
        ])
        self.db.rows("quiz_attempts").append({"id": "qa-1", "user_id": USER, "guide_id": B, "score": 3})
        self.db.rows("retain_misses").append({"user_id": USER, "guide_id": B, "misses": ["x"]})

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_merge_moves_history_backs_up_and_restores(self):
        preview = self.client.get(f"/guides/{A}/merge-preview?other={B}", headers=H).json()
        self.assertEqual((preview["added_cards"], preview["quiz_attempts"], preview["merge"]["blocked"]), (1, 1, None))
        out = self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H)
        self.assertEqual(out.status_code, 200, out.text)
        guides = {g["id"]: g for g in self.db.rows("study_guides")}
        self.assertNotIn(B, guides, "the merged-away set is deleted")
        self.assertEqual(len(guides[A]["flashcards"]), 2)
        self.assertIn("## From Cells lecture", guides[A]["notes"])
        self.assertEqual(self.db.rows("quiz_attempts")[0]["guide_id"], A, "history moved to the kept set")
        backup = self.db.rows("guide_merge_backups")[0]
        self.assertEqual(backup["merged_guide"]["title"], "Cells lecture")
        self.assertEqual(backup["saved_rows"]["retain_misses"][0]["misses"], ["x"])

        listed = self.client.get(f"/guides/{A}/merged", headers=H).json()["merged"]
        self.assertEqual([m["title"] for m in listed], ["Cells lecture"])
        self.db.rows("retain_misses").clear()  # Postgres deletes them with the set
        restored = self.client.post(f"/guides/merges/{backup['id']}/restore", headers=H)
        self.assertEqual(restored.status_code, 200, restored.text)
        guides = {g["id"]: g for g in self.db.rows("study_guides")}
        self.assertEqual(guides[B]["title"], "Cells lecture")
        self.assertEqual(self.db.rows("quiz_attempts")[0]["guide_id"], B, "history moves back")
        self.assertEqual(self.db.rows("retain_misses")[0]["guide_id"], B)
        self.assertEqual(self.client.get(f"/guides/{A}/merged", headers=H).json()["merged"], [])
        again = self.client.post(f"/guides/merges/{backup['id']}/restore", headers=H)
        self.assertEqual(again.status_code, 404)

    def test_shared_sets_are_only_ever_kept(self):
        self.db.rows("study_guides")[1]["visibility"] = "public"
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 409)
        self.db.rows("study_guides")[1]["visibility"] = "private"
        self.db.rows("classroom_items").append({"classroom_id": "r1", "item_type": "guide", "item_id": B})
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 409)
        self.db.rows("classroom_items").clear()
        self.db.rows("shared_sets").append({"id": "s1", "guide_id": B, "owner_id": USER})
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 409)
        # The other way round is fine: the shared set is the one kept.
        self.db.rows("shared_sets")[0]["guide_id"] = A
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 200)

    def test_only_your_own_sets(self):
        self.db.rows("study_guides")[1]["user_id"] = OTHER_USER
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 404)
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": A}, headers=H).status_code, 400)

    def test_old_backups_cannot_be_restored(self):
        self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H)
        backup = self.db.rows("guide_merge_backups")[0]
        backup["created_at"] = "2026-01-01T00:00:00+00:00"
        self.assertEqual(self.client.post(f"/guides/merges/{backup['id']}/restore", headers=H).status_code, 404)

    def test_before_the_migration_merging_is_off(self):
        db = BeforeMigration()
        db.tables = self.db.tables
        self.db = db
        self.assertEqual(self.client.post(f"/guides/{A}/merge", json={"other": B}, headers=H).status_code, 503)
        self.assertEqual(self.client.get("/guides/duplicates", headers=H).json(), {"available": False, "pairs": []})
        self.assertEqual(self.client.get(f"/guides/{A}/merged", headers=H).json(), {"merged": []})


class DuplicateTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.patches = [patch("routers.guides.get_user_id", return_value=USER), patch("routers.guides.get_supabase", side_effect=lambda: self.db),
                        patch("services.guide_duplicates._client", return_value=object())]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)
        same = [card("What is the powerhouse of the cell?", "Mitochondria"), card("What is osmosis?", "Water moving"),
                card("What is diffusion?", "Spreading out"), card("What is a ribosome?", "Makes proteins")]
        self.db.rows("study_guides").extend([
            guide(A, "Cell biology", same, created_at="2026-09-01T00:00:00+00:00"),
            guide(B, "Cell biology lecture", same[:3] + [card("What is the nucleus?", "Holds DNA")], created_at="2026-10-01T00:00:00+00:00"),
            guide(C, "French revolution", [card("When did the Bastille fall?", "1789")]),
        ])

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_word_overlap_finds_candidates(self):
        pairs = guide_duplicates.candidates(self.db.rows("study_guides"), {A, B, C})
        self.assertEqual([(a, b) for _, a, b in pairs], [(A, B)])
        self.assertEqual(guide_duplicates.candidates(self.db.rows("study_guides"), set()), [], "a pair needs one set that can go")

    def test_ai_confirms_once_and_the_older_or_shared_set_is_kept(self):
        with patch("services.guide_duplicates.ai_same", return_value=True) as ai:
            first = self.client.get("/guides/duplicates", headers=H).json()
            second = self.client.get("/guides/duplicates", headers=H).json()
        self.assertEqual(ai.call_count, 1, "each pair is checked once")
        self.assertEqual(first, second)
        pair = first["pairs"][0]
        self.assertEqual((pair["keep"]["id"], pair["merge"]["id"]), (A, B), "the older set is kept")
        self.db.rows("study_guides")[1]["visibility"] = "public"
        self.db.rows("study_guides")[1]["version"] = 1
        pair = self.client.get("/guides/duplicates", headers=H).json()["pairs"][0]
        self.assertEqual((pair["keep"]["id"], pair["merge"]["id"]), (B, A), "a shared set is always the one kept")

    def test_ai_says_different_or_not_now(self):
        with patch("services.guide_duplicates.ai_same", return_value=False):
            self.assertEqual(self.client.get("/guides/duplicates", headers=H).json()["pairs"], [])
        self.db.rows("guide_duplicate_checks").clear()
        with patch("services.guide_duplicates.ai_same", return_value=True):
            self.assertEqual(len(self.client.get("/guides/duplicates", headers=H).json()["pairs"]), 1)
            self.assertEqual(self.client.post("/guides/duplicates/dismiss", json={"a": B, "b": A}, headers=H).status_code, 200)
            self.assertEqual(self.client.get("/guides/duplicates", headers=H).json()["pairs"], [])

    def test_daily_ai_budget(self):
        today = guide_duplicates._day_start()
        for i in range(guide_duplicates.AI_PER_DAY):
            self.db.rows("guide_duplicate_checks").append({"user_id": USER, "guide_a": f"x{i}", "guide_b": f"y{i}", "verdict": "different", "checked_at": today})
        with patch("services.guide_duplicates.ai_same", return_value=True) as ai:
            self.assertEqual(self.client.get("/guides/duplicates", headers=H).json()["pairs"], [])
        ai.assert_not_called()

    def test_dismiss_needs_your_own_sets(self):
        self.db.rows("study_guides")[2]["user_id"] = OTHER_USER
        self.assertEqual(self.client.post("/guides/duplicates/dismiss", json={"a": A, "b": C}, headers=H).status_code, 404)


if __name__ == "__main__":
    unittest.main()
