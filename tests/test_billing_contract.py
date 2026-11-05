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

    def test_tier_is_matched_exactly_never_guessed(self):
        self.assertEqual(billing._tier_of({"lookup_key": "classroom_pro_499_monthly"}), "pro")
        self.assertEqual(billing._tier_of({"lookup_key": "classroom_aw_monthly"}), "weapon")
        self.assertIsNone(billing._tier_of({"id": "price_old", "recurring": {"interval": "year"}}))

    def test_old_9_99_prices_keep_every_feature(self):
        self.assertEqual(billing._tier_of({"lookup_key": "classroom_pro_monthly"}), "weapon")
        self.assertEqual(billing._tier_of({"lookup_key": "classroom_pro_semester"}), "weapon")
        self.assertEqual(entitlements.tier_for(row(plan="classroom_plus")), "weapon")
        self.assertEqual(entitlements.tier_for(row(plan="pro")), "weapon")


class TierTests(unittest.TestCase):
    def test_each_tier_resolves_from_its_stored_plan(self):
        self.assertEqual(entitlements.tier_for(row(plan="classroom_pro")), "pro")
        self.assertEqual(entitlements.tier_for(row(plan="academic_weapon")), "weapon")
        self.assertEqual(entitlements.tier_for(row(plan="classroom_pro", status="canceled")), "free")

    def test_limits_follow_the_owner_plan(self):
        pro, weapon = entitlements.LIMITS["pro"], entitlements.LIMITS["weapon"]
        self.assertEqual((pro["guide"], pro["tutor"], pro["practice"], pro["lecture_minute"]), (15, 300, 15, 150))
        self.assertEqual((weapon["guide"], weapon["tutor"], weapon["practice"], weapon["lecture_minute"]), (100, 1000, 75, 1200))
        for feature in entitlements.FEATURES:
            self.assertLessEqual(entitlements.LIMITS["free"][feature], entitlements.LIMITS["pro"][feature], feature)
            self.assertLessEqual(entitlements.LIMITS["pro"][feature], entitlements.LIMITS["weapon"][feature], feature)

    def test_every_paid_tier_reports_the_plan_the_extension_reads(self):
        for plan, tier in (("classroom_pro", "pro"), ("academic_weapon", "weapon")):
            with patch.object(entitlements, "subscription_row", return_value=row(plan=plan)), \
                 patch.object(entitlements, "usage_counts", return_value={f: 0 for f in entitlements.FEATURES}):
                state = entitlements.entitlement("user-1")
            self.assertEqual(state["plan"], "classroom_plus")
            self.assertEqual(state["tier"], tier)
            self.assertEqual(state["features"]["guide"]["limit"], entitlements.LIMITS[tier]["guide"])

    def test_a_limit_names_the_cheapest_tier_that_raises_it(self):
        with self.assertRaises(HTTPException) as free_guide:
            raise entitlements.LimitReached("guide", 3, 3, "free")
        self.assertEqual(free_guide.exception.detail["upgrade_tier"], "pro")
        with self.assertRaises(HTTPException) as free_visual:
            raise entitlements.LimitReached("visual", 10, 10, "free")
        self.assertEqual(free_visual.exception.detail["upgrade_tier"], "weapon")
        with self.assertRaises(HTTPException) as top:
            raise entitlements.LimitReached("guide", 100, 100, "weapon")
        self.assertIsNone(top.exception.detail["upgrade_tier"])
        self.assertEqual(top.exception.detail["plan"], "classroom_plus")


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
            patch.dict(os.environ, {"STRIPE_PRO_PRICE_ID": "price_pro",
                                    "STRIPE_WEAPON_PRICE_ID": "price_aw"}),
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
        self.assertEqual(kwargs["items"][0]["price"], "price_aw")

    def test_trial_is_one_per_account(self):
        used = row(plan="free", status="canceled", pro_trial_started_at=NOW.isoformat())
        with patch.object(billing, "subscription_row", return_value=used):
            with self.assertRaises(HTTPException) as raised:
                billing.start_trial("Bearer t")
        self.assertEqual(raised.exception.status_code, 409)

    def test_checkout_uses_the_matching_price_and_allows_promo_codes(self):
        self.stripe.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout")
        for tier, price in (("pro", "price_pro"), ("weapon", "price_aw")):
            with patch.object(billing, "subscription_row", return_value=None):
                billing.create_checkout_session(billing.CheckoutRequest(tier=tier), "Bearer t")
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

    def _paid(self, plan):
        return row(plan=plan, stripe_subscription_id="sub_paid")

    def test_upgrading_charges_the_difference_on_the_same_subscription(self):
        self.stripe.Subscription.retrieve.return_value = {"id": "sub_paid", "items": {"data": [{"id": "si_1"}]}, "metadata": {}}
        self.stripe.Subscription.modify.return_value = {"id": "sub_paid"}
        with patch.object(billing, "subscription_row", return_value=self._paid("classroom_pro")):
            billing.change_plan(billing.ChangePlanRequest(tier="weapon"), "Bearer t")
        args, kwargs = self.stripe.Subscription.modify.call_args
        self.assertEqual(args[0], "sub_paid")
        self.assertEqual(kwargs["items"], [{"id": "si_1", "price": "price_aw"}])
        self.assertEqual(kwargs["proration_behavior"], "always_invoice")
        self.assertEqual(kwargs["payment_behavior"], "pending_if_incomplete")
        self.stripe.checkout.Session.create.assert_not_called()

    def test_downgrading_credits_the_next_invoice(self):
        self.stripe.Subscription.retrieve.return_value = {"id": "sub_paid", "items": {"data": [{"id": "si_1"}]}, "metadata": {}}
        self.stripe.Subscription.modify.return_value = {"id": "sub_paid"}
        with patch.object(billing, "subscription_row", return_value=self._paid("academic_weapon")):
            billing.change_plan(billing.ChangePlanRequest(tier="pro"), "Bearer t")
        kwargs = self.stripe.Subscription.modify.call_args.kwargs
        self.assertEqual(kwargs["items"][0]["price"], "price_pro")
        self.assertEqual(kwargs["proration_behavior"], "create_prorations")

    def test_a_declined_upgrade_leaves_the_plan_alone(self):
        self.stripe.Subscription.retrieve.return_value = {"id": "sub_paid", "items": {"data": [{"id": "si_1"}]}, "metadata": {}}
        self.stripe.Subscription.modify.return_value = {"id": "sub_paid", "pending_update": {"expires_at": 1}}
        with patch.object(billing, "subscription_row", return_value=self._paid("classroom_pro")):
            with self.assertRaises(HTTPException) as raised:
                billing.change_plan(billing.ChangePlanRequest(tier="weapon"), "Bearer t")
        self.assertEqual(raised.exception.status_code, 402)
        billing._upsert_from_subscription.assert_not_called()

    def test_free_and_trial_students_change_plan_through_checkout(self):
        for current in (None, row(status="trialing", pro_trial_started_at=NOW.isoformat())):
            with patch.object(billing, "subscription_row", return_value=current):
                with self.assertRaises(HTTPException) as raised:
                    billing.change_plan(billing.ChangePlanRequest(tier="weapon"), "Bearer t")
            self.assertEqual(raised.exception.status_code, 409)
        self.stripe.Subscription.modify.assert_not_called()

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


class SavedTierTests(unittest.TestCase):
    def _saved(self, subscription):
        db = MagicMock()
        with patch.object(billing, "get_supabase", return_value=db), \
             patch.dict(os.environ, {"STRIPE_PRO_PRICE_ID": "price_pro", "STRIPE_WEAPON_PRICE_ID": "price_aw"}):
            billing._upsert_from_subscription(subscription, "user-1")
        return db.table.return_value.upsert.call_args.args[0]

    def test_each_price_saves_its_tier(self):
        pro = self._saved({"id": "sub_1", "status": "active", "items": {"data": [{"price": {"id": "price_pro"}}]}})
        weapon = self._saved({"id": "sub_2", "status": "active", "items": {"data": [{"price": {"lookup_key": "classroom_aw_monthly"}}]}})
        self.assertEqual((pro["plan"], weapon["plan"]), ("classroom_pro", "academic_weapon"))

    def test_a_trial_is_saved_as_academic_weapon(self):
        trial = self._saved({"id": "sub_t", "status": "trialing", "metadata": {"kind": "trial"},
                             "items": {"data": [{"price": {"id": "price_aw"}}]}})
        self.assertEqual(trial["plan"], "academic_weapon")


class PricingSurfaceTests(unittest.TestCase):
    def test_plans_show_both_paid_tiers_at_their_prices(self):
        source = (ROOT / "web" / "lib" / "plans.js").read_text()
        self.assertIn("'$4.99'", source)
        self.assertIn("'$9.99'", source)
        self.assertIn("Academic Weapon", source)
        self.assertNotIn("$6.99", source)
        self.assertNotIn("$29", source)


if __name__ == "__main__":
    unittest.main()
