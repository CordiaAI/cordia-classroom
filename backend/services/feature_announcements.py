"""What's new: which released features a student has been shown, opened or dismissed, and the facts
the web app needs to decide who sees which feature (web/lib/featureReleases.js).

Stored in onboarding_progress.features (migration 20261120120000) as
{"announced": [ids], "opened": [ids], "dismissed": [ids]}. Lists only grow (a merge of what's
saved and what's sent), are capped, and hold registry-shaped ids only. Before the migration,
`stored` is False and the web app keeps the lists in the browser instead.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

KINDS = ("announced", "opened", "dismissed")
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
CAP = 200


def clean(ids) -> list[str]:
    out = []
    for value in ids or []:
        if isinstance(value, str) and ID.match(value) and value not in out:
            out.append(value)
    return out[:CAP]


def merge(saved: Optional[dict], change: dict) -> dict:
    saved = saved if isinstance(saved, dict) else {}
    return {kind: clean([*clean(saved.get(kind)), *clean(change.get(kind))]) for kind in KINDS}


def load(db, user_id: str) -> tuple[bool, dict, bool]:
    """(stored, features, has_row). stored is False before the migration."""
    try:
        rows = db.table("onboarding_progress").select("features").eq("user_id", user_id).limit(1).execute().data or []
    except Exception:
        return False, merge({}, {}), False
    return True, merge((rows[0] if rows else {}).get("features"), {}), bool(rows)


def save(db, user_id: str, change: dict) -> tuple[bool, dict]:
    stored, current, has_row = load(db, user_id)
    if not stored:
        return False, merge(current, change)
    features = merge(current, change)
    now = datetime.now(timezone.utc).isoformat()
    try:
        if has_row:
            db.table("onboarding_progress").update({"features": features, "updated_at": now}).eq("user_id", user_id).execute()
        else:
            # No wizard row yet: a missing row already means "style" (GET /onboarding), so this keeps it.
            db.table("onboarding_progress").insert({"user_id": user_id, "step": "style", "features": features, "updated_at": now}).execute()
    except Exception:
        logger.warning("Feature announcements not saved", exc_info=True)
        return False, features
    return True, features


def account(db, user_id: str) -> dict:
    """Who the student is, for each feature's audience: when they joined, plan, Canvas, nursing."""
    created_at = None
    try:
        user = db.auth.admin.get_user_by_id(user_id).user
        created = getattr(user, "created_at", None)
        created_at = created.isoformat() if hasattr(created, "isoformat") else (str(created) if created else None)
    except Exception:
        pass
    plan = "free"
    try:
        from services.entitlements import plan_for, subscription_row
        plan = "pro" if plan_for(subscription_row(user_id)) == "pro" else "free"
    except Exception:
        pass
    canvas = False
    try:
        rows = db.table("canvas_connections").select("status").eq("user_id", user_id).limit(1).execute().data or []
        canvas = bool(rows and rows[0].get("status") == "connected")
    except Exception:
        pass
    nursing = False
    try:
        rows = db.table("study_guides").select("id").eq("user_id", user_id).not_.is_("nclex_questions", "null").limit(1).execute().data or []
        nursing = bool(rows)
    except Exception:
        pass
    return {"created_at": created_at, "plan": plan, "canvas": canvas, "nursing": nursing}
