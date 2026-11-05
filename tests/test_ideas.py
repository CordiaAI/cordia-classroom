"""Stable idea ids and the one "did this idea really change?" rule (social plan, Stage 4)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services import ideas  # noqa: E402


def card(front, back, idea_id=None):
    out = {"front": front, "back": back}
    if idea_id:
        out["idea_id"] = idea_id
    return out


def mcq(question, answer, idea_id=None):
    out = {"question": question, "options": ["Wrong one", answer, "Wrong two"], "correct_index": 1}
    if idea_id:
        out["idea_id"] = idea_id
    return out


class RealChangeTests(unittest.TestCase):
    def test_punctuation_capitals_and_spaces_are_not_changes(self):
        self.assertFalse(ideas.is_real_change("What is ATP?", "Energy  carrier.", "what is atp", "energy carrier"))

    def test_small_typo_fixes_are_not_changes(self):
        q = "Which organelle produces most of the energy a cell uses for its daily work"
        self.assertFalse(ideas.is_real_change(q, "The mitocondria", q, "The mitochondria"))
        self.assertFalse(ideas.is_real_change(q + " and growth", "x", q + " and its growth", "x"))

    def test_rewording_is_a_change(self):
        self.assertTrue(ideas.is_real_change("What is ATP?", "An energy carrier", "What is ATP?", "A protein that stores fat"))
        self.assertTrue(ideas.is_real_change("Who founded it?", "Henry Dunant", "Who led it in 1900?", "Henry Dunant"))

    def test_a_different_number_is_always_a_change(self):
        long = "The society was founded in Geneva in {} by a group of five citizens who met that winter"
        self.assertTrue(ideas.is_real_change("When?", long.format(1863), "When?", long.format(1864)))
        self.assertTrue(ideas.is_real_change("When?", "1863", "When?", "1864"))

    def test_fingerprint_matches_learn(self):
        self.assertEqual(ideas.fingerprint48("  What IS the powerhouse, of the cell?! " * 3)[:20], "what is the powerhou")
        self.assertLessEqual(len(ideas.fingerprint48("x" * 200)), 48)


class AssignTests(unittest.TestCase):
    def test_new_guides_get_one_id_per_idea_shared_by_card_and_question(self):
        cards, quiz = ideas.assign_idea_ids(None, None, [card("What is ATP?", "Energy"), card("What is DNA?", "Genes")],
                                            [mcq("What is DNA?", "Genes"), mcq("What is ATP?", "Energy")])
        self.assertTrue(all(ideas.valid_id(c["idea_id"]) for c in cards))
        self.assertNotEqual(cards[0]["idea_id"], cards[1]["idea_id"])
        self.assertEqual(quiz[0]["idea_id"], cards[1]["idea_id"])
        self.assertEqual(quiz[1]["idea_id"], cards[0]["idea_id"])

    def test_ids_survive_reordering_and_an_insert_at_the_top(self):
        old = [card("What is ATP?", "Energy", "aaaaaa0001"), card("What is DNA?", "Genes", "aaaaaa0002")]
        new = [card("What is RNA?", "A messenger"), card("What is DNA?", "Genes"), card("What is ATP?", "Energy")]
        cards, _ = ideas.assign_idea_ids(old, None, new, None)
        self.assertEqual([c["idea_id"] for c in cards[1:]], ["aaaaaa0002", "aaaaaa0001"])
        self.assertNotIn(cards[0]["idea_id"], {"aaaaaa0001", "aaaaaa0002"})

    def test_an_edited_question_keeps_its_id(self):
        old = [card("What does the mitochondria produce for the cell?", "ATP", "aaaaaa0001")]
        cards, _ = ideas.assign_idea_ids(old, None, [card("What does the mitochondria produce for each cell?", "ATP")], None)
        self.assertEqual(cards[0]["idea_id"], "aaaaaa0001")

    def test_matching_by_fingerprint_and_carried_ids(self):
        long_q = "Which process turns light energy into chemical energy stored in glucose molecules in plants"
        old = [card(long_q, "Photosynthesis", "aaaaaa0001"), card("Q2", "B", "aaaaaa0002")]
        cards, _ = ideas.assign_idea_ids(old, None, [card(long_q + " and algae", "Photosynthesis"), card("Brand new", "x", "aaaaaa0002")], None)
        self.assertEqual(cards[0]["idea_id"], "aaaaaa0001")
        self.assertEqual(cards[1]["idea_id"], "aaaaaa0002", "a carried id is kept")

    def test_duplicates_share_and_an_old_id_is_never_given_to_two_ideas(self):
        old = [card("What is ATP?", "Energy", "aaaaaa0001")]
        cards, _ = ideas.assign_idea_ids(old, None, [card("What is ATP?", "Energy"), card("What is ATP?", "Energy"),
                                                     card("What is ATP made of?", "Adenine and phosphates")], None)
        self.assertEqual(cards[0]["idea_id"], cards[1]["idea_id"])
        self.assertNotEqual(cards[2]["idea_id"], "aaaaaa0001")

    def test_regenerated_quiz_keeps_ids_from_cards(self):
        cards = [card("What is ATP?", "Energy", "aaaaaa0001")]
        _, quiz = ideas.assign_idea_ids(cards, [mcq("What is ATP?", "Energy", "aaaaaa0001")], None, [mcq("What is ATP?", "Energy")])
        self.assertEqual(quiz[0]["idea_id"], "aaaaaa0001")

    def test_lists_not_written_stay_none(self):
        cards, quiz = ideas.assign_idea_ids([], [], None, None)
        self.assertIsNone(cards)
        self.assertIsNone(quiz)


class DiffTests(unittest.TestCase):
    def test_added_changed_removed(self):
        old = ideas.ideas_of([card("What is ATP?", "Energy", "aaaaaa0001"), card("What is DNA?", "Genes", "aaaaaa0002"),
                              card("Old idea?", "Gone", "aaaaaa0003")], None)
        new = ideas.ideas_of([card("What is ATP?", "energy.", "aaaaaa0001"), card("What is DNA?", "A sugar", "aaaaaa0002"),
                              card("New idea?", "Here", "aaaaaa0004")], None)
        out = ideas.diff(old, new)
        self.assertEqual([i["idea_id"] for i in out["added"]], ["aaaaaa0004"])
        self.assertEqual([i["idea_id"] for i in out["changed"]], ["aaaaaa0002"])
        self.assertEqual(out["changed"][0]["before"]["answer"], "Genes")
        self.assertEqual([i["idea_id"] for i in out["removed"]], ["aaaaaa0003"])

    def test_ideas_of_merges_card_and_question(self):
        out = ideas.ideas_of([card("What is ATP?", "Energy", "aaaaaa0001")], [mcq("What is ATP?", "Energy", "aaaaaa0001"), mcq("Only in quiz?", "Yes", "aaaaaa0009")])
        self.assertEqual([i["idea_id"] for i in out], ["aaaaaa0001", "aaaaaa0009"])
        self.assertIn("quiz", out[0])
        self.assertEqual(out[1]["answer"], "Yes")


if __name__ == "__main__":
    unittest.main()
