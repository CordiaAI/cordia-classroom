import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import stripe

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import billing


def subscription(sub_id, status="active", product="prod_pro", metadata=None):
    return {"id": sub_id, "status": status, "customer": "cus_live", "metadata": metadata or {},
            "items": {"data": [{"price": {"id": "price_x", "product": product}}]}}


def fake_stripe(subscriptions):
    api = MagicMock()
    api.Customer.list.return_value = SimpleNamespace(data=[SimpleNamespace(id="cus_live")])
    api.Subscription.list.return_value = SimpleNamespace(data=subscriptions)
    api.Price.retrieve.return_value = SimpleNamespace(product="prod_pro")
    return api


class EmailSyncTests(unittest.TestCase):
    def setUp(self):
        billing._last_sync.clear()

    def run_sync(self, subscriptions, **kwargs):
        api = fake_stripe(subscriptions)
        with patch.object(billing, "_stripe", return_value=api), \
             patch.object(billing, "_user_email", return_value="student@example.com"), \
             patch.object(billing, "_price_id", return_value="price_x"), \
             patch.object(billing, "_plain", side_effect=lambda value: value), \
             patch.object(billing, "_upsert_from_subscription") as upsert:
            linked = billing.sync_pro_from_stripe("user-1", **kwargs)
        return linked, upsert, api

    def test_active_pro_subscription_under_the_email_is_linked_and_tagged(self):
        linked, upsert, api = self.run_sync([subscription("sub_old", status="canceled"), subscription("sub_live")])
        self.assertTrue(linked)
        upsert.assert_called_once()
        self.assertEqual(upsert.call_args[0][0]["id"], "sub_live")
        api.Subscription.modify.assert_called_once_with("sub_live", metadata={"user_id": "user-1"})

    def test_other_products_and_ended_subscriptions_are_ignored(self):
        linked, upsert, _ = self.run_sync([subscription("sub_other", product="prod_other"), subscription("sub_gone", status="canceled")])
        self.assertFalse(linked)
        upsert.assert_not_called()

    def test_a_subscription_tied_to_another_account_is_never_moved(self):
        linked, upsert, api = self.run_sync([subscription("sub_theirs", metadata={"user_id": "user-2"})])
        self.assertFalse(linked)
        upsert.assert_not_called()
        api.Subscription.modify.assert_not_called()

    def test_lookup_runs_at_most_once_per_window_unless_forced(self):
        self.run_sync([])
        _, _, api = self.run_sync([])
        api.Customer.list.assert_not_called()
        _, _, api = self.run_sync([], force=True)
        api.Customer.list.assert_called_once()


class StaleCustomerTests(unittest.TestCase):
    def test_a_customer_missing_from_stripe_is_replaced(self):
        api = MagicMock()
        api.Customer.retrieve.side_effect = stripe.InvalidRequestError("No such customer: 'cus_old'", "id")
        api.Customer.create.return_value = SimpleNamespace(id="cus_new")
        database = MagicMock()
        with patch.object(billing, "_stripe", return_value=api), \
             patch.object(billing, "_customer_id", return_value="cus_old"), \
             patch.object(billing, "get_supabase", return_value=database):
            self.assertEqual(billing._ensure_customer("user-1", "student@example.com"), "cus_new")
        database.table.return_value.upsert.assert_called_once_with(
            {"user_id": "user-1", "stripe_customer_id": "cus_new"}, on_conflict="user_id"
        )

    def test_a_live_customer_is_kept(self):
        api = MagicMock()
        api.Customer.retrieve.return_value = SimpleNamespace(id="cus_live")
        with patch.object(billing, "_stripe", return_value=api), \
             patch.object(billing, "_customer_id", return_value="cus_live"):
            self.assertEqual(billing._ensure_customer("user-1"), "cus_live")
        api.Customer.create.assert_not_called()


class TrialTests(unittest.TestCase):
    def test_trial_links_an_existing_paid_subscription_instead_of_starting(self):
        with patch.object(billing, "get_user_id", return_value="user-1"), \
             patch.object(billing, "subscription_row", return_value={"plan": "free", "status": "cancelled"}), \
             patch.object(billing, "sync_pro_from_stripe", return_value=True), \
             patch.object(billing, "entitlement", return_value={"plan": "classroom_plus"}), \
             patch.object(billing, "_stripe") as api:
            self.assertEqual(billing.start_trial("Bearer token"), {"plan": "classroom_plus"})
        api.return_value.Subscription.create.assert_not_called()

    def test_stripe_failure_becomes_a_clear_message(self):
        api = MagicMock()
        api.Subscription.create.side_effect = stripe.InvalidRequestError("No such customer", "customer")
        with patch.object(billing, "get_user_id", return_value="user-1"), \
             patch.object(billing, "subscription_row", return_value=None), \
             patch.object(billing, "sync_pro_from_stripe", return_value=False), \
             patch.object(billing, "_ensure_customer", return_value="cus_1"), \
             patch.object(billing, "_user_email", return_value=None), \
             patch.object(billing, "_price_id", return_value="price_x"), \
             patch.object(billing, "_stripe", return_value=api):
            with self.assertRaises(billing.HTTPException) as raised:
                billing.start_trial("Bearer token")
        self.assertEqual(raised.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
