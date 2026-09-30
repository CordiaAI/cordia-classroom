import asyncio
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
ROOT = Path(__file__).resolve().parents[1]

from fastapi import HTTPException
from routers import billing


class BillingContractTests(unittest.TestCase):
    @staticmethod
    def _subscription_query(customer_id=None):
        query = MagicMock()
        query.select.return_value.eq.return_value.execute.return_value.data = (
            [{"stripe_customer_id": customer_id}] if customer_id else []
        )
        db = MagicMock()
        db.table.return_value = query
        return db, query

    def test_plan_limits_and_paid_status(self):
        self.assertEqual(billing.PLAN_LIMITS["free"], {"builds": 3, "lightweight_actions": 30})
        self.assertEqual(billing.PLAN_LIMITS["classroom_plus"], {"builds": 25, "lightweight_actions": 250})
        self.assertEqual(billing._plan({"plan": "pro", "status": "active"}), "classroom_plus")
        self.assertEqual(billing._plan({"plan": "classroom_plus", "status": "past_due"}), "free")

    def test_usage_limit_blocks_without_writing(self):
        usage = {
            "builds_used": 3,
            "builds_limit": 3,
            "lightweight_actions_used": 0,
            "lightweight_actions_limit": 30,
        }
        with patch.object(billing, "get_user_plan", return_value=usage):
            with self.assertRaises(HTTPException) as error:
                billing.check_usage("user-1", "build")
        self.assertEqual(error.exception.status_code, 402)

    def test_create_page_surfaces_billing_message_and_upgrade_action(self):
        source = (ROOT / "web" / "pages" / "create.js").read_text(encoding="utf-8")
        self.assertIn("generated.detail.message", source)
        self.assertIn("generated.detail.upgrade_url", source)
        self.assertIn(">View plans</button>", source)

    def test_subscription_ui_exposes_free_monthly_and_yearly_plans(self):
        source = (ROOT / "web" / "pages" / "settings.js").read_text(encoding="utf-8")
        self.assertIn('<div className="plan-name">Free</div>', source)
        self.assertIn("setBillingInterval('monthly')", source)
        self.assertIn("setBillingInterval('yearly')", source)
        self.assertIn("'$6.99'", source)
        self.assertIn("'$59.99'", source)
        self.assertIn("JSON.stringify({ interval: billingInterval })", source)

    def test_record_usage_increments_only_requested_counter(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        with patch.object(billing, "get_supabase", return_value=db):
            billing.record_usage(
                "user-1",
                "lightweight",
                {"builds_used": 2, "lightweight_actions_used": 8},
            )
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["guides_generated"], 2)
        self.assertEqual(payload["lightweight_actions"], 9)

    def test_webhook_rejects_missing_signature(self):
        request = MagicMock()
        request.body = AsyncMock(return_value=b"{}")
        request.headers = {}
        with patch.dict(os.environ, {"STRIPE_WEBHOOK_SECRET": "whsec_test"}, clear=True):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(billing.stripe_webhook(request))
        self.assertEqual(error.exception.status_code, 400)

    def test_plain_supports_current_stripe_objects(self):
        class StripeObject:
            def to_dict(self):
                return {"id": "cs_live_1"}

        self.assertEqual(billing._plain(StripeObject()), {"id": "cs_live_1"})

    def test_monthly_and_yearly_checkout_use_the_matching_price(self):
        stripe_client = MagicMock()
        stripe_client.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout.test")
        prices = {
            "STRIPE_CLASSROOM_PLUS_MONTHLY_PRICE_ID": "price_monthly",
            "STRIPE_CLASSROOM_PLUS_YEARLY_PRICE_ID": "price_yearly",
            "FRONTEND_URL": "https://classroom.cordiaai.io/",
        }
        for interval, expected_price in (("monthly", "price_monthly"), ("yearly", "price_yearly")):
            with self.subTest(interval=interval):
                db, _ = self._subscription_query()
                stripe_client.checkout.Session.create.reset_mock()
                with (
                    patch.dict(os.environ, prices, clear=True),
                    patch.object(billing, "get_user_id", return_value="user-1"),
                    patch.object(billing, "get_user_plan", return_value={"plan": "free"}),
                    patch.object(billing, "get_supabase", return_value=db),
                    patch.object(billing, "_stripe", return_value=stripe_client),
                ):
                    result = billing.create_checkout_session(
                        billing.CheckoutRequest(interval=interval), "Bearer token"
                    )
                self.assertEqual(result, {"url": "https://checkout.test"})
                params = stripe_client.checkout.Session.create.call_args.kwargs
                self.assertEqual(params["mode"], "subscription")
                self.assertEqual(params["line_items"], [{"price": expected_price, "quantity": 1}])
                self.assertEqual(params["client_reference_id"], "user-1")
                self.assertEqual(params["metadata"]["interval"], interval)
                self.assertEqual(params["subscription_data"]["metadata"]["user_id"], "user-1")
                self.assertEqual(
                    params["success_url"],
                    "https://classroom.cordiaai.io/settings?billing=success"
                    "&session_id={CHECKOUT_SESSION_ID}",
                )

    def test_confirm_checkout_activates_only_the_signed_in_user(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        stripe_client = MagicMock()
        stripe_client.checkout.Session.retrieve.return_value = {
            "id": "cs_live_1",
            "status": "complete",
            "payment_status": "paid",
            "subscription": "sub_1",
            "client_reference_id": "user-1",
            "metadata": {"user_id": "user-1"},
        }
        stripe_client.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "customer": "cus_1",
            "status": "active",
            "current_period_end": 1_800_000_000,
            "items": {"data": [{"price": {"recurring": {"interval": "month"}}}]},
        }
        with (
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "get_user_plan", return_value={"plan": "classroom_plus"}),
            patch.object(billing, "get_supabase", return_value=db),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            result = billing.confirm_checkout(
                billing.ConfirmCheckoutRequest(session_id="cs_live_1"), "Bearer token"
            )
        self.assertEqual(result["plan"], "classroom_plus")
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["status"], "active")

    def test_confirm_checkout_rejects_another_users_session(self):
        stripe_client = MagicMock()
        stripe_client.checkout.Session.retrieve.return_value = {
            "id": "cs_live_1",
            "status": "complete",
            "payment_status": "paid",
            "subscription": "sub_1",
            "client_reference_id": "another-user",
            "metadata": {},
        }
        with (
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            with self.assertRaises(HTTPException) as error:
                billing.confirm_checkout(
                    billing.ConfirmCheckoutRequest(session_id="cs_live_1"), "Bearer token"
                )
        self.assertEqual(error.exception.status_code, 403)

    def test_checkout_reuses_existing_stripe_customer(self):
        db, _ = self._subscription_query("cus_existing")
        stripe_client = MagicMock()
        stripe_client.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout.test")
        with (
            patch.dict(
                os.environ,
                {"STRIPE_CLASSROOM_PLUS_MONTHLY_PRICE_ID": "price_monthly"},
                clear=True,
            ),
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "get_user_plan", return_value={"plan": "free"}),
            patch.object(billing, "get_supabase", return_value=db),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            billing.create_checkout_session(billing.CheckoutRequest(), "Bearer token")
        self.assertEqual(
            stripe_client.checkout.Session.create.call_args.kwargs["customer"],
            "cus_existing",
        )

    def test_monthly_checkout_supports_legacy_live_price_during_secret_migration(self):
        db, _ = self._subscription_query()
        stripe_client = MagicMock()
        stripe_client.checkout.Session.create.return_value = SimpleNamespace(url="https://checkout.test")
        with (
            patch.dict(os.environ, {"STRIPE_PRICE_ID": "price_live_monthly"}, clear=True),
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "get_user_plan", return_value={"plan": "free"}),
            patch.object(billing, "get_supabase", return_value=db),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            billing.create_checkout_session(billing.CheckoutRequest(), "Bearer token")
        self.assertEqual(
            stripe_client.checkout.Session.create.call_args.kwargs["line_items"],
            [{"price": "price_live_monthly", "quantity": 1}],
        )

    def test_portal_uses_existing_customer_and_subscription_return_url(self):
        db, _ = self._subscription_query("cus_existing")
        stripe_client = MagicMock()
        stripe_client.billing_portal.Session.create.return_value = SimpleNamespace(
            url="https://portal.test"
        )
        with (
            patch.dict(
                os.environ,
                {"FRONTEND_URL": "https://classroom.cordiaai.io/"},
                clear=True,
            ),
            patch.object(billing, "get_user_id", return_value="user-1"),
            patch.object(billing, "get_supabase", return_value=db),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            result = billing.create_portal_session("Bearer token")
        self.assertEqual(result, {"url": "https://portal.test"})
        stripe_client.billing_portal.Session.create.assert_called_once_with(
            customer="cus_existing",
            return_url="https://classroom.cordiaai.io/settings?section=subscription",
        )

    def test_subscription_update_upserts_by_user(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        event = {
            "type": "customer.subscription.updated",
            "data": {"object": {
                "id": "sub_1",
                "customer": "cus_1",
                "status": "active",
                "metadata": {"user_id": "user-1"},
                "items": {"data": [{"price": {"recurring": {"interval": "month"}}}]},
            }},
        }
        with patch.object(billing, "get_supabase", return_value=db):
            billing.process_stripe_event(event)
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["billing_interval"], "monthly")

    def test_subscription_created_uses_same_entitlement_path(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        event = {
            "type": "customer.subscription.created",
            "data": {"object": {
                "id": "sub_created",
                "customer": "cus_1",
                "status": "trialing",
                "metadata": {"user_id": "user-1"},
                "items": {"data": [{"price": {"recurring": {"interval": "year"}}}]},
            }},
        }
        with patch.object(billing, "get_supabase", return_value=db):
            billing.process_stripe_event(event)
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["status"], "trialing")
        self.assertEqual(payload["billing_interval"], "yearly")

    def test_checkout_completion_activates_subscription_by_client_reference(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        stripe_client = MagicMock()
        stripe_client.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "customer": "cus_1",
            "status": "active",
            "current_period_end": 1_800_000_000,
            "items": {"data": [{"price": {"recurring": {"interval": "month"}}}]},
        }
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "subscription": "sub_1",
                "client_reference_id": "user-1",
                "metadata": {},
            }},
        }
        with (
            patch.object(billing, "get_supabase", return_value=db),
            patch.object(billing, "_stripe", return_value=stripe_client),
        ):
            billing.process_stripe_event(event)
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["billing_interval"], "monthly")

    def test_subscription_deleted_downgrades_and_clears_paid_period(self):
        query = MagicMock()
        db = MagicMock()
        db.table.return_value = query
        event = {
            "type": "customer.subscription.deleted",
            "data": {"object": {"id": "sub_1", "customer": "cus_1"}},
        }
        with patch.object(billing, "get_supabase", return_value=db):
            billing.process_stripe_event(event)
        payload = query.update.call_args.args[0]
        self.assertEqual(payload["plan"], "free")
        self.assertEqual(payload["status"], "cancelled")
        self.assertIsNone(payload["billing_interval"])
        self.assertIsNone(payload["current_period_end"])
        query.update.return_value.eq.assert_called_once_with("stripe_customer_id", "cus_1")
        query.update.return_value.eq.return_value.eq.assert_called_once_with(
            "stripe_subscription_id", "sub_1"
        )


if __name__ == "__main__":
    unittest.main()
