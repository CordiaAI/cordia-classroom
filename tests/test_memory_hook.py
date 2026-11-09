"""'Help me remember': a memory hook after a missed question, shaped by the About-you answers."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi import HTTPException
from routers import quiz
from services import llm, retain

GUIDE_ID = "00000000-0000-0000-0000-000000000001"
FOUNDER = {"question": "Who founded ATO?", "options": ["Otis Allan Glazebrook", "x", "y", "z"], "correct_index": 0}


class Rows:
    def __init__(self, rows, broken=False):
        self.rows, self.broken = rows, broken

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def execute(self):
        if self.broken:
            raise RuntimeError("down")
        return SimpleNamespace(data=self.rows)


def database(answers=(), broken=False):
    tables = {"study_guides": Rows([{"quiz_questions": [FOUNDER]}]), "onboarding_answers": Rows(list(answers), broken)}
    db = MagicMock()
    db.table.side_effect = lambda name: tables[name]
    return db


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class MentionsAnswerTests(unittest.TestCase):
    def test_the_hook_must_state_the_answer(self):
        self.assertTrue(retain.mentions_answer("Picture Otis Allan Glazebrook glazing a brook.", "Otis Allan Glazebrook"))
        self.assertTrue(retain.mentions_answer("Mitoses copy the cell.", "Mitosis"))
        self.assertFalse(retain.mentions_answer("Picture someone glazing a brook.", "Otis Allan Glazebrook"))
        self.assertFalse(retain.mentions_answer("It happened just before Christmas.", "December 24, 1776"))
        self.assertTrue(retain.mentions_answer("December 25, 1776: the same day as Christmas.", "December 25, 1776"))
        self.assertFalse(retain.mentions_answer("December 26, 1776", "December 25, 1776"))


class MemoryHookTests(unittest.TestCase):
    def call(self, text, **kwargs):
        chat = MagicMock(return_value=reply(text))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            result = llm.memory_hook("Who founded ATO?", "Otis Allan Glazebrook", **kwargs)
        return result, chat

    def test_a_good_hook_is_returned_with_the_style_and_interests_in_the_prompt(self):
        hook = "Otis Allan Glazebrook: picture you glazing a brook before kickoff."
        result, chat = self.call('{"hook": "%s"}' % hook, style="funny", interests=["sports"], previous="Old one")
        self.assertEqual(result, {"hook": hook})
        self.assertEqual(chat.call_args.args[1], "retain_remember")
        messages = chat.call_args.kwargs["messages"]
        self.assertIn("funny", messages[0]["content"])
        self.assertIn("INTERESTS: sports", messages[1]["content"])
        self.assertIn("Old one", messages[1]["content"])

    def test_several_styles_let_the_model_pick_one(self):
        _, chat = self.call('{"hook": "Otis Allan Glazebrook glazes a brook."}', style=["funny", "letters"])
        system = chat.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Preferred styles (use the one that suits this answer best): " + llm.MEMORY_STYLES["funny"]
                      + "; " + llm.MEMORY_STYLES["letters"], system)
        _, chat = self.call('{"hook": "Otis Allan Glazebrook glazes a brook."}', style=["nonsense"])
        self.assertIn("Preferred style: " + llm.MEMORY_STYLES["link"], chat.call_args.kwargs["messages"][0]["content"])

    def test_hooks_without_the_answer_or_about_the_student_are_dropped(self):
        self.assertEqual(self.call('{"hook": "Picture someone glazing a brook."}')[0], {})
        self.assertEqual(self.call('{"hook": "The student should picture Otis Allan Glazebrook."}')[0], {})
        self.assertEqual(self.call("not json")[0], {})


class GroundedTrickTests(unittest.TestCase):
    """Feedback 6-8: tricks start from the question's cue, clear a quality bar, and may build on the
    student's own material, which the reply names so the app can show "Linked to"."""

    CONTEXT = [{"kind": "lecture", "id": "l1", "title": "Week 3 lecture", "snippet": "Glazebrook founded ATO in Richmond."}]

    def call(self, text, context=()):
        chat = MagicMock(return_value=reply(text))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            return llm.memory_hook("Who founded ATO?", "Otis Allan Glazebrook", context=context), chat

    def test_the_prompt_asks_for_the_cue_techniques_and_examples(self):
        _, chat = self.call('{"hook": "When you see ATO, think Otis Allan Glazebrook.", "linked": null}', self.CONTEXT)
        system, user = (m["content"] for m in chat.call_args.kwargs["messages"])
        self.assertIn("When you see X, think Y", system)
        for technique in ("vivid image", "acronym", "number shape", "tiny story"):
            self.assertIn(technique, system)
        self.assertIn(llm.MEMORY_EXAMPLES, system)
        self.assertIn("[1] Week 3 lecture: Glazebrook founded ATO in Richmond.", user)

    def test_a_used_link_is_named_and_a_made_up_one_ignored(self):
        hook = "When you see ATO, think of your Week 3 lecture in Richmond: Otis Allan Glazebrook."
        result, _ = self.call('{"hook": "%s", "linked": 1}' % hook, self.CONTEXT)
        self.assertEqual(result["linked"], {"kind": "lecture", "id": "l1", "title": "Week 3 lecture"})
        for linked in ("2", "null", "true", '"1"'):
            result, _ = self.call('{"hook": "%s", "linked": %s}' % (hook, linked), self.CONTEXT)
            self.assertNotIn("linked", result)

    def test_no_context_means_no_material_block(self):
        _, chat = self.call('{"hook": "Otis Allan Glazebrook"}')
        self.assertNotIn("OWN MATERIAL", chat.call_args.kwargs["messages"][1]["content"])


class MemoryContextTests(unittest.TestCase):
    def db(self, guides=(), lectures=(), chats=(), progress=(), broken=()):
        from unittest.mock import MagicMock as M
        rows = {"study_guides": list(guides), "lectures": list(lectures), "tutor_chats": list(chats), "guide_progress": list(progress)}
        calls = {}

        def table(name):
            query = M()
            for method in ("select", "eq", "neq", "in_", "order", "limit", "text_search"):
                getattr(query, method).return_value = query
            if name in broken:
                query.execute.side_effect = RuntimeError("down")
            else:
                query.execute.return_value = SimpleNamespace(data=rows[name])
            calls[name] = query
            return query

        db = M()
        db.table.side_effect = table
        return db, calls

    def test_own_rows_only_and_the_current_guide_excluded(self):
        from services import memory_context
        db, calls = self.db(guides=[{"id": "g2", "title": "Greek life", "study_guide": "Otis Glazebrook founded ATO."}])
        found = memory_context.related_material(db, "u1", "g1", "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual(found, [{"kind": "guide", "id": "g2", "title": "Greek life", "snippet": "Otis Glazebrook founded ATO."}])
        calls["study_guides"].eq.assert_any_call("user_id", "u1")
        calls["study_guides"].neq.assert_called_with("id", "g1")
        calls["lectures"].eq.assert_any_call("user_id", "u1")
        calls["tutor_chats"].eq.assert_any_call("user_id", "u1")

    def test_well_known_guides_rank_first_and_at_most_three_come_back(self):
        from services import memory_context
        guides = [{"id": f"g{i}", "title": f"Guide {i}", "notes": "Glazebrook founded it."} for i in range(2, 7)]
        progress = [{"guide_id": "g5", "progress": {"a": {"l": 3, "at": "2099-01-01"}}}]
        db, _ = self.db(guides=guides, progress=progress)
        found = memory_context.related_material(db, "u1", "g1", "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual(len(found), 3)
        self.assertEqual(found[0]["id"], "g5")

    def test_failures_and_passing_mentions_give_nothing(self):
        from services import memory_context
        db, _ = self.db(chats=[{"id": "c1", "title": "Chat", "messages": [{"role": "user", "text": "Glazebrook?"}]}],
                        broken=("study_guides", "lectures"))
        self.assertEqual(memory_context.related_material(db, "u1", "g1", "Who founded ATO?", "Otis Allan Glazebrook"), [])

    def test_saved_tutor_chats_are_read_in_their_stored_shape(self):
        from services import memory_context
        messages = [{"role": "user", "text": "Who started ATO?"},  # tutor_sessions stores {"role", "text"}
                    {"role": "ai", "text": "Otis Allan Glazebrook founded ATO in Richmond."}]
        db, _ = self.db(chats=[{"id": "c1", "title": "Greek life chat", "messages": messages}])
        found = memory_context.related_material(db, "u1", "g1", "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual(found, [{"kind": "tutor", "id": "c1", "title": "Greek life chat",
                                  "snippet": "Otis Allan Glazebrook founded ATO in Richmond."}])

    def test_key_terms_skip_filler(self):
        from services.memory_context import key_terms
        self.assertEqual(key_terms("When was the Cumberland Road finished?", "1867"), ["cumberland", "finished", "road"])


class RememberRouteTests(unittest.TestCase):
    def run_route(self, db, hook=None, body=None):
        make = MagicMock(return_value={"hook": hook} if hook else {})
        require, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                            memory_hook=make, require=require, record=record):
            try:
                result = quiz.help_me_remember(GUIDE_ID, body or quiz.RememberRequest(concept=0), "Bearer t")
            except HTTPException as error:
                result = error
        return result, make, require, record

    def test_uses_the_newest_answers_and_charges_light(self):
        answers = [
            {"question_id": "interests", "answer": {"value": ["music", "food"]}},
            {"question_id": "memory_style", "answer": {"value": "rhyme"}},
            {"question_id": "memory_style", "answer": {"value": "funny"}},  # older
        ]
        result, make, require, record = self.run_route(database(answers), hook="Glazebrook", body=quiz.RememberRequest(concept=0, previous=" Last "))
        self.assertEqual(result, {"hook": "Glazebrook"})
        self.assertEqual(make.call_args.args, ("Who founded ATO?", "Otis Allan Glazebrook", ["rhyme"], ["music", "food"], "Last"))
        require.assert_called_once_with("u1", "light")
        record.assert_called_once_with("u1", "light")

    def test_defaults_when_unanswered_skipped_or_unreadable(self):
        for db in (database(), database([{"question_id": "memory_style", "answer": {"skipped": True}}]), database(broken=True)):
            _, make, _, _ = self.run_route(db, hook="Glazebrook")
            self.assertEqual(make.call_args.args[2:4], (["link"], []))

    def test_several_styles_since_version_2(self):
        answers = [{"question_id": "memory_style", "answer": {"value": ["funny", "letters"]}},
                   {"question_id": "memory_style", "answer": {"value": "rhyme"}}]  # older, version 1
        _, make, _, _ = self.run_route(database(answers), hook="Glazebrook")
        self.assertEqual(make.call_args.args[2], ["funny", "letters"])

    def test_no_hook_is_not_charged(self):
        result, _, require, record = self.run_route(database())
        self.assertIsInstance(result, HTTPException)
        self.assertEqual(result.status_code, 502)
        require.assert_called_once()
        record.assert_not_called()

    def test_unknown_question(self):
        result, make, _, _ = self.run_route(database(), hook="x", body=quiz.RememberRequest(concept=5))
        self.assertEqual(result.status_code, 400)
        make.assert_not_called()

    def test_over_the_cap(self):
        def over(*_):
            raise HTTPException(status_code=402, detail="limit")
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=database()),
                            memory_hook=MagicMock(), require=over):
            with self.assertRaises(HTTPException) as caught:
                quiz.help_me_remember(GUIDE_ID, quiz.RememberRequest(concept=0), "Bearer t")
        self.assertEqual(caught.exception.status_code, 402)


if __name__ == "__main__":
    unittest.main()
