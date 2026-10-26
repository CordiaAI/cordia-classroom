import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
ROOT = Path(__file__).resolve().parents[1]

from fastapi import HTTPException
from routers import feedback


class FluentQuery:
    def __init__(self, data=None):
        self.data = data or []
        self.calls = []

    def _return_self(self, name, *args, **kwargs):
        self.calls.append((name, args, kwargs))
        return self

    def select(self, *args, **kwargs): return self._return_self("select", *args, **kwargs)
    def eq(self, *args, **kwargs): return self._return_self("eq", *args, **kwargs)
    def limit(self, *args, **kwargs): return self._return_self("limit", *args, **kwargs)
    def order(self, *args, **kwargs): return self._return_self("order", *args, **kwargs)
    def range(self, *args, **kwargs): return self._return_self("range", *args, **kwargs)
    def update(self, *args, **kwargs): return self._return_self("update", *args, **kwargs)
    def upsert(self, *args, **kwargs): return self._return_self("upsert", *args, **kwargs)
    def execute(self): return SimpleNamespace(data=self.data)


class MemoryFeedbackQuery:
    def __init__(self, rows):
        self.rows = rows
        self.operation = "select"
        self.payload = None
        self.filters = []
        self.start = 0
        self.end = None

    def upsert(self, payload, **kwargs):
        self.operation = "upsert"
        self.payload = payload
        return self

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def limit(self, count):
        self.start, self.end = 0, count
        return self

    def order(self, *_args, **_kwargs): return self

    def range(self, start, end):
        self.start, self.end = start, end + 1
        return self

    def _matches(self, row):
        return all(row.get(field) == value for field, value in self.filters)

    def execute(self):
        if self.operation == "upsert":
            duplicate = next((row for row in self.rows if (
                row["user_id"], row["client_request_id"]
            ) == (
                self.payload["user_id"], self.payload["client_request_id"]
            )), None)
            if duplicate:
                return SimpleNamespace(data=[])
            row = {"id": f"feedback-{len(self.rows) + 1}", "created_at": "2026-09-24T12:00:00Z", **self.payload}
            self.rows.append(row)
            return SimpleNamespace(data=[row])
        matches = [row for row in self.rows if self._matches(row)]
        if self.operation == "update":
            for row in matches:
                row.update(self.payload)
        return SimpleNamespace(data=matches[self.start:self.end])


class MemoryFeedbackDatabase:
    def __init__(self):
        self.rows = []

    def table(self, name):
        if name != "feedback":
            raise AssertionError(f"unexpected table: {name}")
        return MemoryFeedbackQuery(self.rows)


class FeedbackContractTests(unittest.TestCase):
    def test_complete_submission_to_review_flow_preserves_account_and_context(self):
        database = MemoryFeedbackDatabase()
        request = feedback.FeedbackRequest(
            message="The displayed explanation contradicts the source.",
            category="incorrect_content",
            page_path="/quiz/guide-9?attempt=private",
            context={"guide_id": "guide-9", "question_id": "question-4"},
            client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e",
        )
        with (
            patch.dict(os.environ, {"FEEDBACK_REVIEWER_USER_IDS": "staff-user"}, clear=True),
            patch.object(feedback, "get_user_id", side_effect=["student-user", "staff-user"]),
            patch.object(feedback, "get_supabase", return_value=database),
        ):
            submitted = feedback.submit_feedback(request, "Bearer student")
            review_queue = feedback.list_feedback(
                category="incorrect_content",
                status="new",
                limit=50,
                offset=0,
                authorization="Bearer staff",
            )

        self.assertTrue(submitted["submitted"])
        self.assertEqual(len(review_queue["items"]), 1)
        item = review_queue["items"][0]
        self.assertEqual(item["id"], submitted["feedback_id"])
        self.assertEqual(item["user_id"], "student-user")
        self.assertEqual(item["page_path"], "/quiz/guide-9")
        self.assertEqual(item["guide_id"], "guide-9")
        self.assertEqual(item["question_id"], "question-4")

    def test_submission_uses_server_identity_sanitized_context_and_idempotency(self):
        query = FluentQuery([{"id": "feedback-1"}])
        db = MagicMock()
        db.table.return_value = query
        request = feedback.FeedbackRequest(
            message="  The answer is incorrect.  ",
            category="incorrect_content",
            page_path="/quiz/guide-1?token=private#answer",
            context={"guide_id": " guide-1 ", "question_id": "question-2"},
            client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e",
        )

        with (
            patch.object(feedback, "get_user_id", return_value="user-1"),
            patch.object(feedback, "get_supabase", return_value=db),
        ):
            result = feedback.submit_feedback(request, "Bearer valid")

        self.assertEqual(result, {"submitted": True, "feedback_id": "feedback-1"})
        upsert = next(call for call in query.calls if call[0] == "upsert")
        payload = upsert[1][0]
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["message"], "The answer is incorrect.")
        self.assertEqual(payload["page_path"], "/quiz/guide-1")
        self.assertEqual(payload["guide_id"], "guide-1")
        self.assertEqual(payload["status"], "new")
        self.assertEqual(upsert[2]["on_conflict"], "user_id,client_request_id")
        self.assertTrue(upsert[2]["ignore_duplicates"])

    def test_only_the_senders_own_screenshots_are_kept(self):
        user = "11111111-2222-4333-8444-555555555555"
        other = "99999999-2222-4333-8444-555555555555"
        shot = "6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e.png"
        query = FluentQuery([{"id": "feedback-1"}])
        db = MagicMock()
        db.table.return_value = query
        request = feedback.FeedbackRequest(
            message="The button overlaps.", category="bug", client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2f",
            attachments=[f"{user}/{shot}", f"{other}/{shot}", "../../etc/passwd"],
        )
        with patch.object(feedback, "get_user_id", return_value=user), patch.object(feedback, "get_supabase", return_value=db):
            feedback.submit_feedback(request, "Bearer valid")
        payload = next(call for call in query.calls if call[0] == "upsert")[1][0]
        self.assertEqual(payload["attachments"], [f"{user}/{shot}"])

    def test_feedback_is_kept_when_the_attachments_column_is_missing(self):
        calls = []

        class OldTable(FluentQuery):
            def upsert(self, row, **kwargs):
                calls.append(row)
                if "attachments" in row:
                    raise RuntimeError("column feedback.attachments does not exist")
                return super().upsert(row, **kwargs)

        user = "11111111-2222-4333-8444-555555555555"
        db = MagicMock()
        db.table.return_value = OldTable([{"id": "feedback-1"}])
        request = feedback.FeedbackRequest(message="Bug", category="bug", client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df30",
                                           attachments=[f"{user}/6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e.jpg"])
        with patch.object(feedback, "get_user_id", return_value=user), patch.object(feedback, "get_supabase", return_value=db):
            result = feedback.submit_feedback(request, "Bearer valid")
        self.assertTrue(result["submitted"])
        self.assertNotIn("attachments", calls[-1])

    def test_duplicate_request_returns_existing_item(self):
        insert_query = FluentQuery([])
        duplicate_query = FluentQuery([{"id": "existing-feedback"}])
        db = MagicMock()
        db.table.side_effect = [insert_query, duplicate_query]
        request = feedback.FeedbackRequest(
            message="Still reproducible",
            category="bug",
            client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e",
        )
        with (
            patch.object(feedback, "get_user_id", return_value="user-1"),
            patch.object(feedback, "get_supabase", return_value=db),
        ):
            result = feedback.submit_feedback(request, "Bearer valid")
        self.assertEqual(result["feedback_id"], "existing-feedback")
        self.assertIn(("eq", ("user_id", "user-1"), {}), duplicate_query.calls)

    def test_input_is_bounded_and_category_is_closed(self):
        for request in (
            {"message": "   ", "category": "bug"},
            {"message": "valid", "category": "feature"},
            {"message": "x" * 2001, "category": "other"},
        ):
            with self.subTest(request=request):
                with self.assertRaises(ValidationError):
                    feedback.FeedbackRequest(
                        **request,
                        client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e",
                    )

    def test_absolute_or_protocol_relative_paths_are_discarded(self):
        for path in ("https://example.test/private?token=1", "//example.test/private"):
            request = feedback.FeedbackRequest(
                message="valid",
                category="other",
                page_path=path,
                client_request_id="6f0fe5fa-e5e6-4fb1-b4da-36adbc94df2e",
            )
            self.assertIsNone(request.page_path)

    def test_ordinary_user_cannot_read_or_update_review_queue(self):
        with (
            patch.dict(os.environ, {"FEEDBACK_REVIEWER_USER_IDS": "staff-user"}, clear=True),
            patch.object(feedback, "get_user_id", return_value="student-user"),
        ):
            with self.assertRaises(HTTPException) as list_error:
                feedback.list_feedback(authorization="Bearer valid")
            with self.assertRaises(HTTPException) as update_error:
                feedback.update_feedback_status(
                    "feedback-1",
                    feedback.FeedbackStatusUpdate(status="reviewing"),
                    "Bearer valid",
                )
        self.assertEqual(list_error.exception.status_code, 403)
        self.assertEqual(update_error.exception.status_code, 403)

    def test_assigned_reviewer_can_filter_and_change_status(self):
        list_query = FluentQuery([{"id": "feedback-1", "status": "new"}])
        update_query = FluentQuery([{"id": "feedback-1", "status": "planned"}])
        db = MagicMock()
        db.table.side_effect = [list_query, update_query]
        with (
            patch.dict(os.environ, {"FEEDBACK_REVIEWER_USER_IDS": "staff-user"}, clear=True),
            patch.object(feedback, "get_user_id", return_value="staff-user"),
            patch.object(feedback, "get_supabase", return_value=db),
        ):
            listed = feedback.list_feedback(
                category="bug",
                status="new",
                limit=50,
                offset=0,
                authorization="Bearer valid",
            )
            updated = feedback.update_feedback_status(
                "3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c",
                feedback.FeedbackStatusUpdate(status="planned"),
                "Bearer valid",
            )
        self.assertEqual(listed["items"][0]["id"], "feedback-1")
        self.assertIn(("eq", ("category", "bug"), {}), list_query.calls)
        self.assertIn(("eq", ("status", "new"), {}), list_query.calls)
        update_call = next(call for call in update_query.calls if call[0] == "update")
        self.assertEqual(update_call[1][0], {"status": "planned", "reviewed_by": "staff-user"})
        self.assertEqual(updated["item"]["status"], "planned")

    def test_migration_keeps_feedback_behind_the_server(self):
        migration = (ROOT / "supabase" / "migrations" / "20260924183243_beta_feedback_review.sql").read_text(encoding="utf-8")
        self.assertIn("feedback_user_request_once", migration)
        self.assertIn("enable row level security", migration)
        self.assertIn("revoke all on table public.feedback from public, anon, authenticated", migration)
        self.assertIn("grant select, insert, update on table public.feedback to service_role", migration)


if __name__ == "__main__":
    unittest.main()
