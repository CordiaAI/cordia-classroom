import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz
from services import print_items as P

PAIRS = [
    {"question": "What is a Lied?", "answer": "A Lied is a German art song for solo voice and piano."},
    {"question": "What is program music?", "answer": "Program music is instrumental music with a literary or pictorial association."},
    {"question": "What did Wagner call his operas?", "answer": "Wagner called his operas music dramas."},
    {"question": "Where did Impressionism begin, and where did the term come from?", "answer": "It began as a movement in painting. The term came from a painting by Claude Monet."},
    {"question": "What characterizes Impressionist music?", "answer": "It features unresolved dissonances, blurred harmonies, and shimmering orchestral color, rather than a strong pull to the tonic."},
    {"question": "What is the idée fixe?", "answer": "It is Berlioz's recurring main theme, transformed in each movement. It represents the beloved."},
    {"question": "Who is the leading Impressionist composer?", "answer": "Debussy."},
]


class StemTests(unittest.TestCase):
    def test_repeated_subject_and_linking_verb_are_removed(self):
        options = ["A Lied is a Russian folk dance for solo violin and harp.", "A Lied is a German art song for solo voice and piano.",
                   "A Lied is a French art song for chorus and organ.", "A Lied is an Italian opera aria for tenor and full orchestra."]
        self.assertEqual(P.strip_stem("What is a Lied?", options)[1], "A German art song for solo voice and piano.")
        self.assertEqual(P.strip_stem("What is a Lied?", options)[3], "An Italian opera aria for tenor and full orchestra.")

    def test_a_restated_question_is_removed(self):
        options = ["Wagner called his operas music pageants", "Wagner called his operas music dramas"]
        self.assertEqual(P.strip_stem("What did Wagner call his operas?", options), ["Music pageants", "Music dramas"])
        options = ["It is associated with the fall of Vienna to Napoleon in 1805", "It is associated with the fall of Warsaw to Russia in 1831"]
        self.assertEqual(P.strip_stem("What historical event is associated with Chopin's Revolutionary étude?", options)[1],
                         "The fall of Warsaw to Russia in 1831")

    def test_never_strips_what_not_every_option_shares_or_the_subject_alone(self):
        options = ["Program music is opera overture music", "Absolute music is music lacking any association"]
        self.assertEqual(P.strip_stem("What is program music?", options), options)
        options = ["Brahms used French poetry instead of the Latin liturgy", "Brahms used German Bible texts instead of the Latin liturgy"]
        self.assertEqual(P.strip_stem("How did Brahms's Requiem text differ from the traditional one?", options), options)

    def test_capitalizes_after_an_opening_quote(self):
        options = ['Tempo rubato means "steady beat."', 'Tempo rubato means "robbed time."']
        self.assertEqual(P.strip_stem("What does tempo rubato mean?", options)[1], '"Robbed time."')


class MatchingAndShortTests(unittest.TestCase):
    def test_matching_uses_short_what_is_questions(self):
        items = {item["term"]: item["definition"] for item in P.matching(PAIRS)}
        self.assertEqual(items["Lied"], "A German art song for solo voice and piano")
        self.assertEqual(items["Idée fixe"], "Berlioz's recurring main theme, transformed in each movement")
        self.assertNotIn("Impressionism", " ".join(items))

    def test_short_answer_uses_the_guides_own_why_how_questions(self):
        items = P.short_answer(PAIRS)
        self.assertEqual([item["question"] for item in items], ["What characterizes Impressionist music?"])
        self.assertEqual(items[0]["key"], PAIRS[4]["answer"])
        self.assertEqual(items[0]["points"], 4)


class FillTests(unittest.TestCase):
    def test_blanks_must_be_words_from_the_stored_answer(self):
        ok = P.check_fill("The term Impressionism came from a painting by [[Claude Monet]].", PAIRS[3]["question"], PAIRS[3]["answer"])
        self.assertEqual(ok["blanks"], ["Claude Monet"])
        self.assertEqual(ok["points"], 1)
        self.assertEqual(ok["parts"], ["The term Impressionism came from a painting by ", {"blank": "Claude Monet"}, "."])
        self.assertIsNone(P.check_fill("The term came from a painting by [[Renoir]].", PAIRS[3]["question"], PAIRS[3]["answer"]))
        self.assertIsNone(P.check_fill("The term came from a painting by [[Monet's]].", PAIRS[3]["question"], PAIRS[3]["answer"]))

    def test_no_new_facts_no_give_away_and_one_or_two_blanks(self):
        q, a = PAIRS[3]["question"], PAIRS[3]["answer"]
        self.assertIsNone(P.check_fill("The term came from a famous 1872 painting by [[Claude Monet]].", q, a))
        self.assertIsNone(P.check_fill("Claude Monet: the term came from a painting by [[Claude Monet]].", q, a))
        self.assertIsNone(P.check_fill("It began as a movement in painting.", q, a))
        self.assertIsNone(P.check_fill("[[It]] [[began]] as a [[movement]] in painting.", q, a))
        two = P.check_fill("The term Impressionism came from a [[painting]] by [[Claude Monet]].", q, a)
        self.assertEqual(two["points"], 2)
        # A blank repeated in the rest of the sentence gives itself away.
        self.assertIsNone(P.check_fill("Impressionism began in [[painting]]; the term came from a painting by Claude Monet.", q, a))

    def test_fill_items_keeps_only_checked_sentences(self):
        indexes = [3, 6]
        items = P.fill_items(PAIRS, indexes, [
            {"id": 0, "sentence": "The term came from a painting by [[Claude Monet]]."},
            {"id": 1, "sentence": "The leading Impressionist composer is [[Ravel]]."},
            {"id": 9, "sentence": "Out of range [[x]]."},
        ])
        self.assertEqual([item["source"] for item in items], [3])


class PrintRouteTests(unittest.TestCase):
    GUIDE = "\n".join(f"Q{i + 1}: {p['question']}\nA{i + 1}: {p['answer']}" for i, p in enumerate(PAIRS))
    QUIZ = [{"question": "What did Wagner call his operas?", "options": ["Wagner called his operas music dramas.", "Wagner called his operas music pageants.", "Wagner called his operas lyric sketches."], "correct_index": 0}]

    def _run(self, fill, remaining_quizzes=3, cached=None):
        query = MagicMock()
        for name in ("select", "eq", "update"):
            getattr(query, name).return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"title": "Music", "folder_id": None, "study_guide": self.GUIDE, "print_items": cached, "quiz_questions": self.QUIZ}])
        database = MagicMock()
        database.table.return_value = query
        def writer_reply(client, pairs):
            indexes = P.fill_candidates(pairs)
            return P.fill_items(pairs, indexes, [{"id": indexes.index(3), "sentence": "The term came from a painting by [[Claude Monet]]."}])
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "remaining", return_value=remaining_quizzes), \
             patch.object(quiz, "require"), patch.object(quiz, "record") as record, \
             patch.object(quiz, "get_openai_client", return_value=None), \
             patch.object(quiz, "_print_fill", side_effect=writer_reply) as writer:
            result = quiz.printable_items("00000000-0000-0000-0000-000000000001", quiz.PrintRequest(fill=fill), "Bearer t")
        return result, query, record, writer

    def test_free_types_cost_nothing_and_fill_counts_as_one_ai_quiz(self):
        result, _, record, writer = self._run(fill=False)
        self.assertEqual(result["mc"][0]["options"][0], "Music dramas")
        self.assertIsNone(result["fill"])
        writer.assert_not_called()
        record.assert_not_called()
        result, query, record, writer = self._run(fill=True)
        self.assertEqual(len(result["fill"]), 1)
        record.assert_called_once_with("student-1", "ai_quiz")
        saved = query.update.call_args[0][0]["print_items"]
        self.assertEqual(saved["source"], P.source_hash(quiz._parse_qa_pairs(self.GUIDE)))

    def test_cached_fill_is_reused_for_free(self):
        pairs = quiz._parse_qa_pairs(self.GUIDE)
        cached = {"v": P.VERSION, "source": P.source_hash(pairs), "matching": P.matching(pairs), "short": P.short_answer(pairs),
                  "fill": [{"id": "f3", "source": 3, "parts": [{"blank": "Claude Monet"}], "blanks": ["Claude Monet"], "points": 1}]}
        result, query, record, writer = self._run(fill=True, cached=cached)
        self.assertEqual(result["fill"], cached["fill"])
        writer.assert_not_called()
        record.assert_not_called()
        query.update.assert_not_called()

    def test_no_ai_quizzes_left_locks_fill_without_charging(self):
        result, _, record, writer = self._run(fill=True, remaining_quizzes=0)
        self.assertTrue(result["fill_locked"])
        writer.assert_not_called()
        record.assert_not_called()


if __name__ == "__main__":
    unittest.main()
