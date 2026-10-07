"""Stripe billing for CordiaClassroom Pro.

Plans:  Pro Monthly $9.99 (lookup key classroom_pro_monthly)
        Pro Semester $29 / 4 months (lookup key classroom_pro_semester)
Trial:  7 days, no card, one per account. Created server-side and set to cancel
        itself at trial end, so it can never turn into a charge on its own.
Promo:  Codes live only in the Stripe dashboard and are entered at Checkout
        (allow_promotion_codes). Never write a code into this repository.

Stripe is the source of truth; every change reaches user_subscriptions through
_upsert_from_subscription(), whether it came from Checkout, the trial endpoint or
a webhook.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from services.entitlements import (
    ACTIVE_STATUSES,
    PRO,
    TRIAL_DAYS,
    entitlement,
    plan_for,
    subscription_row,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])

Interval = Literal["monthly", "semester"]
LOOKUP_KEYS = {"monthly": "classroom_pro_monthly", "semester": "classroom_pro_semester"}
PRICE_ENV = {"monthly": "STRIPE_PRO_MONTHLY_PRICE_ID", "semester": "STRIPE_PRO_SEMESTER_PRICE_ID"}
_price_cache: dict = {}


class CheckoutRequest(BaseModel):
    interval: Interval = "monthly"
    return_path: Optional[str] = Field(default=None, max_length=300)


class ConfirmCheckoutRequest(BaseModel):
    session_id: str


def _stripe():
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Billing not configured")
    stripe.api_key = key
    return stripe


def _frontend() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _safe_path(path: Optional[str], default: str) -> str:
    if path and path.startswith("/") and not path.startswith("//"):
        return path
    return default


def _plain(value) -> dict:
    if hasattr(value, "to_dict_recursive"):
        return value.to_dict_recursive()
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return dict(value)


def _price_id(interval: str) -> str:
    """Env override first, otherwise resolve the Stripe lookup key once and cache it."""
    configured = os.getenv(PRICE_ENV[interval])
    if configured:
        return configured
    if interval not in _price_cache:
        prices = _stripe().Price.list(lookup_keys=[LOOKUP_KEYS[interval]], active=True, limit=1)
        if not prices.data:
            raise HTTPException(status_code=503, detail="Billing not configured")
        _price_cache[interval] = prices.data[0].id
    return _price_cache[interval]


def _interval_of(price: dict) -> Optional[str]:
    """Which Pro plan a Stripe price is, matched exactly by lookup key or configured id."""
    for name, key in LOOKUP_KEYS.items():
        if price.get("lookup_key") == key or (price.get("id") and price.get("id") == os.getenv(PRICE_ENV[name])):
            return name
    return None


def _iso(ts) -> Optional[str]:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None


def _customer_id(user_id: str) -> Optional[str]:
    row = subscription_row(user_id)
    return row.get("stripe_customer_id") if row else None


def _ensure_customer(user_id: str, email: Optional[str] = None) -> str:
    existing = _customer_id(user_id)
    if existing:
        return existing
    params = {"metadata": {"user_id": user_id}}
    if email:
        params["email"] = email
    return _stripe().Customer.create(**params).id


def _user_email(user_id: str) -> Optional[str]:
    try:
        return get_supabase().auth.admin.get_user_by_id(user_id).user.email
    except Exception:
        return None


def _upsert_from_subscription(subscription: dict, user_id: str) -> None:
    """Mirror one Stripe subscription onto the user's single entitlement row."""
    items = (subscription.get("items") or {}).get("data") or []
    item = items[0] if items else {}
    is_trial = (subscription.get("metadata") or {}).get("kind") == "trial"
    row = {
        "user_id": user_id,
        "source": "stripe",
        "plan": PRO,
        "status": subscription.get("status"),
        "stripe_customer_id": subscription.get("customer"),
        "stripe_subscription_id": subscription.get("id"),
        "billing_interval": None if is_trial else _interval_of(item.get("price") or {}),
        "current_period_start": _iso(subscription.get("current_period_start") or item.get("current_period_start")),
        "current_period_end": _iso(subscription.get("current_period_end") or item.get("current_period_end")),
        "cancel_at_period_end": bool(subscription.get("cancel_at_period_end")) and not is_trial,
    }
    if is_trial:
        row["pro_trial_started_at"] = _iso(subscription.get("trial_start"))
        row["pro_trial_ends_at"] = _iso(subscription.get("trial_end"))
    get_supabase().table("user_subscriptions").upsert(row, on_conflict="user_id").execute()


def _cancel_replaced_trial(previous: Optional[dict], new_subscription_id: str) -> None:
    """A student who pays during a trial must not keep a second (trial) subscription."""
    old_id = (previous or {}).get("stripe_subscription_id")
    if old_id and old_id != new_subscription_id and (previous or {}).get("status") == "trialing":
        try:
            _stripe().Subscription.cancel(old_id)
        except Exception as e:
            logger.warning(f"Could not cancel replaced trial {old_id}: {e}")


def _handle_subscription_event(subscription: dict) -> None:
    user_id = (subscription.get("metadata") or {}).get("user_id")
    if not user_id:
        rows = (
            get_supabase().table("user_subscriptions").select("user_id")
            .eq("stripe_customer_id", subscription.get("customer")).execute()
        )
        if not rows.data:
            logger.warning(f"Stripe subscription {subscription.get('id')} matches no user")
            return
        user_id = rows.data[0]["user_id"]
    current = subscription_row(user_id) or {}
    current_id = current.get("stripe_subscription_id")
    # Events from an old/replaced subscription never overwrite the current one. A late
    # event from a trial the student already replaced by paying is ignored too.
    replaced_trial = (subscription.get("metadata") or {}).get("kind") == "trial"
    if current_id and current_id != subscription.get("id") and (
        subscription.get("status") not in ACTIVE_STATUSES or replaced_trial
    ):
        return
    _upsert_from_subscription(subscription, user_id)


def _handle_subscription_deleted(subscription: dict) -> None:
    result = (
        get_supabase().table("user_subscriptions")
        .update({
            "plan": "free",
            "status": "canceled",
            "stripe_subscription_id": None,
            "billing_interval": None,
            "current_period_start": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
        })
        .eq("stripe_subscription_id", subscription.get("id"))
        .execute()
    )
    if not result.data:
        logger.info(f"Deleted subscription {subscription.get('id')} was not current for any user")


def _activate_checkout(session: dict, user_id: str) -> dict:
    session_user_id = (session.get("metadata") or {}).get("user_id") or session.get("client_reference_id")
    if session_user_id != user_id:
        raise HTTPException(status_code=403, detail="Checkout session does not belong to this account")
    if session.get("status") != "complete":
        raise HTTPException(status_code=409, detail="Checkout is not complete")
    if session.get("payment_status") not in {"paid", "no_payment_required"}:
        raise HTTPException(status_code=409, detail="Payment is still processing")
    subscription_id = session.get("subscription")
    if not subscription_id:
        raise HTTPException(status_code=409, detail="Checkout did not create a subscription")
    if not isinstance(subscription_id, str):
        subscription_id = subscription_id.get("id")
    previous = subscription_row(user_id)
    _upsert_from_subscription(_plain(_stripe().Subscription.retrieve(subscription_id)), user_id)
    _cancel_replaced_trial(previous, subscription_id)
    return entitlement(user_id)


@router.get("/status")
def billing_status(authorization: str = Header(default="")):
    return entitlement(get_user_id(authorization))


@router.post("/create-checkout-session")
def create_checkout_session(body: CheckoutRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    row = subscription_row(user_id)
    on_trial = bool(row and row.get("status") == "trialing" and row.get("pro_trial_started_at"))
    if plan_for(row) == "pro" and not on_trial:
        raise HTTPException(status_code=409, detail="Pro is already active")

    return_path = _safe_path(body.return_path, "/settings?section=subscription")
    sep = "&" if "?" in return_path else "?"
    metadata = {"user_id": user_id, "product": PRO, "interval": body.interval}
    params = {
        "mode": "subscription",
        "line_items": [{"price": _price_id(body.interval), "quantity": 1}],
        "success_url": f"{_frontend()}{return_path}{sep}billing=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{_frontend()}{return_path}{sep}billing=cancelled",
        "client_reference_id": user_id,
        "metadata": metadata,
        "subscription_data": {"metadata": metadata},
        "allow_promotion_codes": True,
    }
    customer_id = row.get("stripe_customer_id") if row else None
    if customer_id:
        params["customer"] = customer_id
    return {"url": _stripe().checkout.Session.create(**params).url}


@router.post("/start-trial")
def start_trial(authorization: str = Header(default="")):
    """7-day Pro trial, no card. It cancels itself at the end; it never bills."""
    user_id = get_user_id(authorization)
    row = subscription_row(user_id)
    if plan_for(row) == "pro":
        raise HTTPException(status_code=409, detail="Pro is already active")
    if row and row.get("pro_trial_started_at"):
        raise HTTPException(status_code=409, detail="Your free trial has already been used")

    customer_id = _ensure_customer(user_id, _user_email(user_id))
    subscription = _stripe().Subscription.create(
        customer=customer_id,
        items=[{"price": _price_id("monthly")}],
        trial_period_days=TRIAL_DAYS,
        cancel_at_period_end=True,
        trial_settings={"end_behavior": {"missing_payment_method": "cancel"}},
        metadata={"user_id": user_id, "product": PRO, "kind": "trial"},
    )
    _upsert_from_subscription(_plain(subscription), user_id)
    return entitlement(user_id)


@router.post("/trial-prompt-seen")
def trial_prompt_seen(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    get_supabase().table("user_subscriptions").update(
        {"trial_end_prompted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("user_id", user_id).execute()
    return {"ok": True}


@router.post("/create-portal-session")
def create_portal_session(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    customer_id = _customer_id(user_id)
    if not customer_id:
        raise HTTPException(status_code=404, detail="No billing account found")
    session = _stripe().billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{_frontend()}/settings?section=subscription",
    )
    return {"url": session.url}


@router.post("/confirm-checkout")
def confirm_checkout(body: ConfirmCheckoutRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if not body.session_id.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Invalid Checkout session")
    return _activate_checkout(_plain(_stripe().checkout.Session.retrieve(body.session_id)), user_id)


def process_stripe_event(event) -> None:
    event_type = event["type"]
    data = _plain(event["data"]["object"])
    if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        if data.get("mode") != "subscription":
            return
        user_id = (data.get("metadata") or {}).get("user_id") or data.get("client_reference_id")
        subscription_id = data.get("subscription")
        if not subscription_id or not user_id:
            raise ValueError("Checkout event is missing subscription metadata")
        previous = subscription_row(user_id)
        _upsert_from_subscription(_plain(_stripe().Subscription.retrieve(subscription_id)), user_id)
        _cancel_replaced_trial(previous, subscription_id)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        _handle_subscription_event(data)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data)


@router.post("/webhook")
async def stripe_webhook(request: Request):
    secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    signature = request.headers.get("stripe-signature", "")
    if not secret:
        raise HTTPException(status_code=503, detail="Billing webhook not configured")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")
    try:
        event = _stripe().Webhook.construct_event(await request.body(), signature, secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature") from exc
    process_stripe_event(event)
    return JSONResponse(content={"received": True})
