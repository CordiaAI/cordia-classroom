"""Single source of truth for CordiaClassroom plans, limits and usage.

Tiers:        free, pro (Classroom Pro $4.99), weapon (Academic Weapon $9.99)
Entitlement:  Stripe -> webhook -> user_subscriptions -> tier_for()
Usage:        one usage_ledger row per successful AI action -> counts per month
Enforcement:  require() before the AI call, record() only after it succeeds.

The published extension reads only `plan` ("classroom_plus" = paid, "free"), so that field
keeps its old meaning for every paid tier; `tier` says which paid tier it is.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase

PRO = "classroom_plus"  # the `plan` value every paid tier reports (extension compatibility)
TIERS = ("free", "pro", "weapon")
PAID_TIERS = ("pro", "weapon")
TIER_NAMES = {"free": "Free", "pro": "Classroom Pro", "weapon": "Academic Weapon"}
# user_subscriptions.plan value per paid tier. "pro" and "classroom_plus" are rows from the old
# single $9.99 plan, which had every feature, so they resolve to Academic Weapon.
STORED_PLAN = {"pro": "classroom_pro", "weapon": "academic_weapon"}
PLAN_TIER = {"classroom_pro": "pro", "academic_weapon": "weapon", "pro": "weapon", "classroom_plus": "weapon"}
ACTIVE_STATUSES = {"active", "trialing"}
# Stripe keeps a subscription past_due while it retries a failed payment, then cancels it
# (Dashboard > Billing > Revenue recovery). A paid tier lasts exactly as long as Stripe says.
PRO_STATUSES = ACTIVE_STATUSES | {"past_due"}
TRIAL_DAYS = 7
TRIAL_TIER = "weapon"  # the trial shows everything, then drops to Free (owner plan 2026-11-03)

# Monthly limits. "guide" is shared by every creation path: web create, extension,
# tutor-built guide and SmartNote -> guide (3 total, not 3 each).
LIMITS = {
    "free": {
        "guide": 3,
        "tutor": 10,
        "learn_my_way": 5,
        "practice": 1,
        "ai_quiz": 1,
        "nclex": 1,
        "retain_types": 1,
        "light": 30,
        # Lecture recording, counted in minutes of audio transcribed.
        "lecture_minute": 30,
        # Napkin visuals, made and stored by the web app's /api/visual route.
        "visual": 10,
    },
    # The study loop: cheap features stay generous, expensive ones are capped.
    "pro": {
        "guide": 15,
        "tutor": 300,
        "learn_my_way": 300,
        "practice": 15,
        "ai_quiz": 200,
        "nclex": 50,
        "retain_types": 300,
        "light": 500,
        "lecture_minute": 150,
        "visual": 10,
    },
    # Automation and the expensive features.
    "weapon": {
        "guide": 100,
        "tutor": 1000,
        "learn_my_way": 300,
        "practice": 75,
        "ai_quiz": 200,
        "nclex": 50,
        "retain_types": 300,
        "light": 500,
        "lecture_minute": 1200,
        "visual": 200,
    },
}
FEATURES = tuple(LIMITS["free"])

FEATURE_LABELS = {
    "guide": "study guides",
    "tutor": "tutor prompts",
    "learn_my_way": "Explain views",
    "practice": "practice sets",
    "ai_quiz": "AI quizzes",
    "nclex": "NCLEX sets",
    "retain_types": "Pro quiz sessions",
    "light": "AI reading actions",
    "lecture_minute": "recording minutes",
    "visual": "visuals",
}
FEATURE_SINGULAR = {
    "guide": "study guide",
    "tutor": "tutor prompt",
    "learn_my_way": "Explain view",
    "practice": "practice set",
    "ai_quiz": "AI quiz",
    "nclex": "NCLEX set",
    "retain_types": "Pro quiz session",
    "light": "AI reading action",
    "lecture_minute": "recording minute",
    "visual": "visual",
}


def limit_message(feature: str, limit: int) -> str:
    if limit == 1:
        return f"You've used your free {FEATURE_SINGULAR.get(feature, FEATURE_LABELS[feature])}."
    return f"You've used all {limit} {FEATURE_LABELS[feature]} this month."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def current_month(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y-%m")


def next_reset(now: Optional[datetime] = None) -> str:
    now = now or _now()
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(year, month, 1, tzinfo=timezone.utc).isoformat()


def _ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _unlimited_ids() -> set:
    return {v.strip() for v in os.getenv("UNLIMITED_USER_IDS", "").split(",") if v.strip()}


def subscription_row(user_id: str) -> Optional[dict]:
    rows = get_supabase().table("user_subscriptions").select("*").eq("user_id", user_id).execute()
    return rows.data[0] if rows.data else None


def tier_for(row: Optional[dict]) -> str:
    """'free', 'pro' or 'weapon'. Paid, promo, trial and manual grants all resolve here."""
    tier = PLAN_TIER.get((row or {}).get("plan"))
    if not tier or row.get("status") not in PRO_STATUSES:
        return "free"
    # A no-card trial ends at pro_trial_ends_at even if Stripe's end-of-trial webhook
    # is late or missed: never keep a paid tier past the trial end, and never charge.
    if row.get("status") == "trialing" and row.get("pro_trial_started_at"):
        trial_ends = _ts(row.get("pro_trial_ends_at"))
        if trial_ends and trial_ends <= _now():
            return "free"
    return tier


def plan_for(row: Optional[dict]) -> str:
    """'pro' for any paid tier, otherwise 'free'."""
    return "free" if tier_for(row) == "free" else "pro"


def usage_counts(user_id: str, month: Optional[str] = None) -> dict:
    result = get_supabase().rpc(
        "feature_usage_counts", {"p_user_id": user_id, "p_month": month or current_month()}
    ).execute()
    counts = {feature: 0 for feature in FEATURES}
    for item in result.data or []:
        if item.get("feature") in counts:
            counts[item["feature"]] = int(item.get("used") or 0)
    return counts


def entitlement(user_id: str) -> dict:
    """Everything the UI needs: plan, trial state, and per-feature remaining counts."""
    now = _now()
    row = subscription_row(user_id) or {}
    tier = tier_for(row)
    plan = "free" if tier == "free" else "pro"
    unlimited = user_id in _unlimited_ids()
    limits = LIMITS[tier]
    used = usage_counts(user_id)
    trial_started = _ts(row.get("pro_trial_started_at"))
    trial_ends = _ts(row.get("pro_trial_ends_at"))
    on_trial = plan == "pro" and row.get("status") == "trialing" and trial_started is not None
    return {
        "plan": PRO if plan == "pro" else "free",
        "tier": tier,
        "tier_name": TIER_NAMES[tier],
        "status": row.get("status") or "none",
        "source": row.get("source") or ("stripe" if row else None),
        "billing_interval": None if on_trial else row.get("billing_interval"),
        "period_end": row.get("current_period_end"),
        "cancel_at_period_end": bool(row.get("cancel_at_period_end")) and not on_trial,
        "past_due": row.get("status") == "past_due",
        "on_trial": on_trial,
        "trial_ends_at": trial_ends.isoformat() if trial_ends else None,
        "trial_available": plan == "free" and trial_started is None,
        "trial_ended_prompt": bool(
            plan == "free" and trial_ends and trial_ends <= now and not row.get("trial_end_prompted_at")
        ),
        "unlimited": unlimited,
        "resets_at": next_reset(now),
        "features": {
            feature: {
                "used": used[feature],
                "limit": limits[feature],
                "remaining": max(0, limits[feature] - used[feature]),
            }
            for feature in FEATURES
        },
    }


class LimitReached(HTTPException):
    def __init__(self, feature: str, used: int, limit: int, tier: str):
        higher = [t for t in TIERS[TIERS.index(tier) + 1:] if LIMITS[t][feature] > limit]
        super().__init__(
            status_code=402,
            detail={
                "code": "limit_reached",
                "feature": feature,
                "label": FEATURE_LABELS[feature],
                "used": used,
                "limit": limit,
                "plan": "free" if tier == "free" else PRO,
                "tier": tier,
                # The cheapest tier that raises this limit, or None at the top.
                "upgrade_tier": higher[0] if higher else None,
                "resets_at": next_reset(),
                "message": limit_message(feature, limit),
                "upgrade_url": "/settings?section=subscription",
            },
        )


def remaining(user_id: str, feature: str) -> int:
    if user_id in _unlimited_ids():
        return 10**6
    tier = tier_for(subscription_row(user_id))
    return max(0, LIMITS[tier][feature] - usage_counts(user_id)[feature])


def require(user_id: str, feature: str) -> None:
    """Raise a 402 before any AI spend if the user has nothing left for this feature."""
    if feature not in FEATURES:
        raise ValueError(f"Unknown feature: {feature}")
    if user_id in _unlimited_ids():
        return
    tier = tier_for(subscription_row(user_id))
    used = usage_counts(user_id)[feature]
    limit = LIMITS[tier][feature]
    if used >= limit:
        raise LimitReached(feature, used, limit, tier)


def record(user_id: str, feature: str, request_key: Optional[str] = None) -> None:
    """Charge one use after success. A repeated request_key is never charged twice."""
    if feature not in FEATURES:
        raise ValueError(f"Unknown feature: {feature}")
    get_supabase().rpc(
        "record_feature_usage",
        {
            "p_user_id": user_id,
            "p_feature": feature,
            "p_month": current_month(),
            "p_request_key": (request_key or None) and f"{feature}:{request_key}"[:120],
        },
    ).execute()
