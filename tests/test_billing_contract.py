import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
ROOT = Path(__file__).resolve().parents[1]

from fastapi import HTTPException
from routers import billing
from services import entitlements

NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)


def row(**overrides):
    base = {"plan": "classroom_plus", "status": "active", "source": "stripe",
            "stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1"}
    base.update(overrides)
    return base


class PlanResolutionTests(unittest.TestCase):
    def test_free_limits_match_the_product_decision(self):
        free = entitlements.LIMITS["free"]
        self.assertEqual((free["guide"], free["tutor"], free["learn_my_way"]), (3, 10, 5))

    def test_guides_share_one_counter_across_web_and_extension(self):
        self.assertNotIn("extension_guide", entitlements.FEATURES)

    def test_active_trialing_and_manual_rows_are_pro(self):
        self.assertEqual(entitlements.plan_for(row()), "pro")
        self.assertEqual(entitlements.plan_for(row(status="trialing")), "pro")
        self.assertEqual(entitlements.plan_for(row(source="manual", stripe_subscription_id=None)), "pro")

    def test_canceled_or_missing_rows_are_free(self):
        self.assertEqual(entitlements.plan_for(None), "free")
        self.assertEqual(entitlements.plan_for(row(status="canceled")), "free")
        self.assertEqual(entitlements.plan_for(row(plan="free")), "free")

    def test_pro_follows_stripe_while_it_retries_a_failed_payment(self):
        self.assertEqual(entitlements.plan_for(row(status="past_due")), "pro")
        self.assertEqual(entitlements.plan_for(row(status="unpaid")), "free")
        self.assertEqual(entitlements.plan_for(row(status="incomplete_expired")), "free")

    def test_plan_interval_is_matched_exactly_never_guessed(self):
        self.assertEqual(billing._interval_of({"lookup_key": "classroom_pro_monthly"}), "monthly")
        self.assertEqual(billing._interval_of({"lookup_key": "classroom_pro_semester"}), "semester")
        self.assertIsNone(billing._interval_of({"id": "price_old", "recurring": {"interval": "year"}}))


class EnforcementTests(unittest.TestCase):
    def test_require_raises_structured_402_at_the_limit(self):
        with patch.object(entitlements, "subscription_row", return_value=None), \
             patch.object(entitlements, "usage_counts", return_value={**{f: 0 for f in entitlements.FEATURES}, "tutor": 10}):
            with self.assertRaises(HTTPException) as raised:
                entitlements.require("user-1", "tutor")
        self.assertEqual(raised.exception.status_code, 402)
        self.assertEqual(raised.exception.detail["code"], "limit_reached")
        self.assertEqual(raised.exception.detail["feature"], "tutor")
        self.assertEqual(raised.exception.detail["limit"], 10)

    def test_require_passes_below_the_limit(self):
        with patch.object(entitlements, "subscription_row", return_value=None), \
             patch.object(entitlements, "usage_counts", return_value={f: 0 for f in entitlements.FEATURES}):
            entitlements.require("user-1", "guide")

    def test_record_namespaces_the_retry_key(self):
        db = MagicMock()
        with patch.object(entitlements, "get_supabase", return_value=db):
            entitlements.record("user-1", "guide", "abc")
        args = db.rpc.call_args.args
        self.assertEqual(args[0], "record_feature_usage")
        self.assertEqual(args[1]["p_request_key"], "guide:abc")

    def test_trial_end_prompt_shows_once_after_the_trial(self):
        ended = row(plan="free", status="canceled",
                    pro_trial_started_at=(NOW - timedelta(days=8)).isoformat(),
                    pro_trial_ends_at=(NOW - timedelta(days=1)).isoformat())
        with patch.object(entitlements, "_now", return_value=NOW), \
             patch.object(entitlements, "subscription_row", return_value=ended), \
             patch.object(entitlements, "usage_counts", return_value={f: 0 for f in entitlements.FEATURES}):
            state = entitlements.entitlement("user-1")
            self.assertTrue(state["trial_ended_prompt"])
            self.assertFalse(state["trial_available"])
        seen = {**ended, "trial_end_prompted_at": NOW.isoformat()}
        with patch.object(entitlements, "_now", return_value=NOW), \
             patch.object(entitlements, "subscription_row", return_value=seen), \
             patch.object(entitlements, "usage_counts", return_value={f: 0 for f in entitlements.FEATURES}):
            self.assertFalse(entitlements.entitlement("user-1")["trial_ended_prompt"])


class BillingRouteTests(unittest.TestCase):
    def setUp(self):
        self.stripe = MagicMock()
        patches = [
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "_stripe", return_value=self.stripe),
            patch.object(billing, "_upsert_from_subscription"),
            patch.object(billing, "entitlement", return_value={"plan": "classroom_plus"}),
            patch.dict(os.environ, {"STRIPE_PRO_MONTHLY_PRICE_ID": "price_m",
                                    "STRIPE_PRO_SEMESTER_PRICE_ID": "price_s"}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_trial_never_bills_by_itself(self):
        self.stripe.Subscription.create.return_value = {"id": "sub_t"}
        with patch.object(billing, "subscription_row", return_value=None), \
             patch.object(billing, "_ensure_customer", return_value="cus_1"), \
             patch.object(billing, "_user_email", return_value=None):
            billing.start_trial("Bearer t")
        kwargs = self.stripe.Subscription.create.call_args.kwargs
        self.assertEqual(kwargs["trial_period_days"], 7)
        self.assertTrue(kwargs["cancel_at_period_end"])
        self.assertEqual(kwargs["trial_settings"]["end_behavior"]["missing_payment_method"], "cancel")
        self.assertEqual(kwargs["metadata"]["kind"], "trial")

    def test_trial_is_one_per_account(self):
        used = row(plan="free", status="canceled", pro_trial_started_at=NOW.isoformat())
        with patch.object(billing, "subscription_row", return_value=used):
            with self.assertRaises(HTTPException) as raised:
                billing.start_trial("Bearer t")
        self.assertEqual(raised.exception.status_code, 409)

    def test_checkout_uses_the_matching_price_and_allows_promo_codes(self):
        self.stripe.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout")
        for interval, price in (("monthly", "price_m"), ("semester", "price_s")):
            with patch.object(billing, "subscription_row", return_value=None):
                billing.create_checkout_session(billing.CheckoutRequest(interval=interval), "Bearer t")
            params = self.stripe.checkout.Session.create.call_args.kwargs
            self.assertEqual(params["line_items"][0]["price"], price)
            self.assertTrue(params["allow_promotion_codes"])

    def test_checkout_is_allowed_during_a_trial_but_not_on_paid_pro(self):
        self.stripe.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout")
        trial = row(status="trialing", pro_trial_started_at=NOW.isoformat())
        with patch.object(billing, "subscription_row", return_value=trial):
            billing.create_checkout_session(billing.CheckoutRequest(), "Bearer t")
        with patch.object(billing, "subscription_row", return_value=row()):
            with self.assertRaises(HTTPException):
                billing.create_checkout_session(billing.CheckoutRequest(), "Bearer t")

    def test_paying_during_a_trial_cancels_the_trial_subscription(self):
        billing._cancel_replaced_trial(row(status="trialing", stripe_subscription_id="sub_trial"), "sub_paid")
        self.stripe.Subscription.cancel.assert_called_once_with("sub_trial")

    def test_events_from_a_replaced_subscription_are_ignored(self):
        with patch.object(billing, "subscription_row", return_value=row(stripe_subscription_id="sub_paid")):
            billing._handle_subscription_event({"id": "sub_trial", "status": "canceled",
                                                "metadata": {"user_id": "user-1"}})
        billing._upsert_from_subscription.assert_not_called()

    def test_a_late_trialing_event_never_replaces_the_paid_subscription(self):
        with patch.object(billing, "subscription_row", return_value=row(stripe_subscription_id="sub_paid")):
            billing._handle_subscription_event({"id": "sub_trial", "status": "trialing",
                                                "metadata": {"user_id": "user-1", "kind": "trial"}})
        billing._upsert_from_subscription.assert_not_called()


class PricingSurfaceTests(unittest.TestCase):
    def test_settings_offers_monthly_and_semester_at_new_prices(self):
        source = (ROOT / "web" / "pages" / "settings.js").read_text() + (ROOT / "web" / "lib" / "plans.js").read_text()
        self.assertIn("$9.99", source)
        self.assertIn("$29", source)
        self.assertIn("semester", source)
        self.assertNotIn("$6.99", source)
        self.assertNotIn("yearly", source)


if __name__ == "__main__":
    unittest.main()
