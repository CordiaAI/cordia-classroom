import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

import main  # noqa: E402
from routers import billing, feedback, search  # noqa: E402


class SearchPatternTests(unittest.TestCase):
    def test_apostrophes_and_quotes_are_searched_as_typed(self):
        self.assertEqual(search._like_pattern("Newton's \"law\""), "%Newton's \"law\"%")

    def test_like_wildcards_match_literally(self):
        self.assertEqual(search._like_pattern("50%_off\\"), "%50\\%\\_off\\\\%")

    def test_route_sends_the_escaped_pattern(self):
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.ilike.return_value = query
        query.limit.return_value = query
        query.execute.return_value = MagicMock(data=[])
        client = MagicMock()
        client.table.return_value = query
        with patch.object(search, "get_user_id", return_value="user-1"), \
             patch.object(search, "get_supabase", return_value=client):
            response = TestClient(main.app).get("/search", params={"q": "Newton's"}, headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({call.args[1] for call in query.ilike.call_args_list}, {"%Newton's%"})


class FeedbackReviewIdTests(unittest.TestCase):
    def test_invalid_feedback_id_is_a_400(self):
        with patch.object(feedback, "_require_reviewer", return_value="reviewer-1"):
            response = TestClient(main.app).get("/feedback/review/not-an-id", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Invalid feedback ID")


class StripeWebhookTests(unittest.TestCase):
    def test_verified_event_is_processed(self):
        stripe_client = MagicMock()
        stripe_client.Webhook.construct_event.return_value = {"type": "invoice.paid", "data": {"object": {}}}
        with patch.dict(os.environ, {"STRIPE_WEBHOOK_SECRET": "whsec_test"}), \
             patch.object(billing, "_stripe", return_value=stripe_client), \
             patch.object(billing, "process_stripe_event") as process:
            response = TestClient(main.app).post("/billing/webhook", content=b"{}", headers={"stripe-signature": "t=1,v1=x"})
        self.assertEqual(response.status_code, 200)
        process.assert_called_once()


if __name__ == "__main__":
    unittest.main()
