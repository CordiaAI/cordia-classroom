"""One memory per student, shared by the Tutor and the Assistant (public.student_memory)."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi import HTTPException
from access import Ctx
from routers import learning
from services import memory_context, student_memory


def table_db(rows=None, fail=False):
    calls = {}

    def table(name):
        query = MagicMock()
        for method in ("select", "eq", "neq", "in_", "order", "limit", "text_search", "upsert", "delete"):
            getattr(query, method).return_value = query
        if fail:
            query.execute.side_effect = Exception("relation public.student_memory does not exist")
        else:
            query.execute.return_value = SimpleNamespace(data=(rows or {}).get(name, []))
        calls[name] = query
        return query

    db = MagicMock()
    db.table.side_effect = table
    return db, calls


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class TutorLearnsTests(unittest.TestCase):
    def test_only_messages_about_the_student_are_checked(self):
        self.assertTrue(student_memory.worth_checking("I'm studying for the NCLEX in March"))
        self.assertTrue(student_memory.worth_checking("Remember that I play guitar"))
        self.assertFalse(student_memory.worth_checking("What is the Krebs cycle?"))
        self.assertFalse(student_memory.worth_checking("my"))

    def test_extracted_facts_are_cleaned_and_capped(self):
        text = ('{"facts": [{"key": "Plays Guitar!", "category": "interest", "value": " Plays  guitar "},'
                ' {"key": "exam", "category": "weird", "value": "Preparing for the NCLEX in March"},'
                ' {"key": "", "value": "no key"}, {"key": "a", "value": "x"}, {"key": "b", "value": "fourth one"}]}')
        with patch("services.llm.get_openai_client"), patch("services.llm_calls.chat", return_value=reply(text)) as sent:
            facts = student_memory.extract("I'm a guitarist preparing for the NCLEX")
        self.assertEqual(facts, [
            {"key": "plays_guitar", "value": "Plays guitar", "category": "interest"},
            {"key": "exam", "value": "Preparing for the NCLEX in March", "category": "other"},
        ])
        self.assertEqual(sent.call_args.args[1], "tutor_memory")
        self.assertIn("never record health", sent.call_args.kwargs["messages"][0]["content"])

    def test_remember_upserts_by_student_source_and_key(self):
        db, calls = table_db()
        saved = student_memory.remember(db, "u1", [{"key": "plays_guitar", "value": "Plays guitar", "category": "interest"}], "tutor", "s1")
        self.assertEqual(saved, 1)
        rows = calls["student_memory"].upsert.call_args.args[0]
        self.assertEqual({k: rows[0][k] for k in ("user_id", "source", "key", "value", "source_ref")},
                         {"user_id": "u1", "source": "tutor", "key": "plays_guitar", "value": "Plays guitar", "source_ref": "s1"})
        self.assertEqual(calls["student_memory"].upsert.call_args.kwargs["on_conflict"], "user_id,source,key")

    def test_before_the_migration_nothing_breaks(self):
        db, _ = table_db(fail=True)
        self.assertEqual(student_memory.remember(db, "u1", [{"key": "k", "value": "value", "category": "other"}]), 0)
        self.assertEqual(student_memory.list_for(db, "u1"), [])
        self.assertFalse(student_memory.forget(db, "u1", "m1"))

    def test_a_plain_question_starts_no_background_work(self):
        with patch.object(student_memory.threading, "Thread") as thread:
            student_memory.learn_from_tutor("u1", "What is osmosis?")
            thread.assert_not_called()
            student_memory.learn_from_tutor("u1", "I'm a nursing student who loves soccer")
            thread.assert_called_once()


class SharedMemoryReachesHelpMeRememberTests(unittest.TestCase):
    def test_memories_from_both_sources_join_the_context(self):
        rows = {"student_memory": [
            {"id": "m1", "source": "assistant", "category": "interest", "value": "Loves the Tennessee Titans"},
            {"id": "m2", "source": "tutor", "category": "other", "value": "Studies at night"},
            {"id": "m3", "source": "tutor", "category": "course", "value": "Taking Cumberland history"},
        ]}
        db, _ = table_db(rows)
        found = memory_context.related_material(db, "u1", "g1", "When was the Cumberland Road finished?", "1867")
        memories = [item for item in found if item["kind"] == "memory"]
        self.assertEqual([item["id"] for item in memories], ["m3", "m1"])
        self.assertEqual(memories[1]["title"], "What you told your Assistant")


class MemoryRouteTests(unittest.TestCase):
    """The routes take the access layer's Ctx (access.own()): the signed-in student and the database."""

    def test_forgetting_needs_a_real_id_and_an_own_row(self):
        ctx = Ctx("u1", table_db()[0])
        with self.assertRaises(HTTPException) as bad:
            learning.forget_memory("../x", ctx)
        self.assertEqual(bad.exception.status_code, 400)
        with self.assertRaises(HTTPException) as gone:
            learning.forget_memory("00000000-0000-0000-0000-000000000001", ctx)
        self.assertEqual(gone.exception.status_code, 404)

    def test_forgetting_is_scoped_to_the_student(self):
        db, calls = table_db({"student_memory": [{"id": "m1"}]})
        learning.forget_memory("00000000-0000-0000-0000-000000000001", Ctx("u1", db))
        calls["student_memory"].eq.assert_any_call("user_id", "u1")


if __name__ == "__main__":
    unittest.main()
