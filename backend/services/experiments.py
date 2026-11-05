"""Experiment assignment (personalization plan step 1.1).

Onboarding v2 goes to 80% of new students and the old flow to 20% for the whole term (owner decision
Q14). The arm is a fixed function of the student and experiment ids, so it never changes and needs no
coordination between machines; the first read writes it down with the student's stratum (sign-in
method, Canvas connected) for the analysis, which reports both arms with intervals and makes no
ship call (results are directional at ~40 signups a month).

Assignment runs only while ONBOARDING_EXPERIMENT is on, and only for students who haven't started
onboarding: switching it on before onboarding v2 ships would label students "v2" who saw the old flow.
Off (the default), everyone gets the old flow and nothing is written.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

ONBOARDING = "onboarding_v2"
EXPERIMENTS = {ONBOARDING: (("v2", 0.8), ("old", 0.2))}


def experiment_on() -> bool:
    return os.getenv("ONBOARDING_EXPERIMENT", "off").strip().lower() in {"1", "on", "true", "yes"}


def bucket(user_id: str, experiment: str) -> float:
    """A number in [0, 1) from the student and experiment ids, the same on every machine."""
    digest = hashlib.sha256(f"{experiment}:{user_id.lower()}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2 ** 64


def arm_for(user_id: str, experiment: str) -> str:
    point, edge = bucket(user_id, experiment), 0.0
    arms = EXPERIMENTS[experiment]
    for name, share in arms:
        edge += share
        if point < edge:
            return name
    return arms[-1][0]


def _stratum(db, user_id: str) -> dict:
    stratum = {"sign_in": "unknown", "canvas": False}
    try:
        user = db.auth.admin.get_user_by_id(user_id).user
        provider = (getattr(user, "app_metadata", None) or {}).get("provider")
        if provider:
            stratum["sign_in"] = str(provider)[:20]
    except Exception:
        log.info("experiment stratum: sign-in method unavailable")
    try:
        stratum["canvas"] = bool(db.table("canvas_connections").select("user_id").eq("user_id", user_id).limit(1).execute().data)
    except Exception:
        log.info("experiment stratum: canvas lookup failed")
    return stratum


def onboarding_arm(db, user_id: str, new_student: bool) -> Optional[str]:
    """The student's onboarding arm: their saved one, else (new students, experiment on) a new one.
    None means not in the experiment (the old flow). Never raises: onboarding must not fail on this."""
    try:
        rows = db.table("experiment_assignments").select("arm").eq("user_id", user_id).eq("experiment", ONBOARDING) \
            .limit(1).execute().data or []
        if rows:
            return rows[0]["arm"]
        if not (new_student and experiment_on()):
            return None
        arm = arm_for(user_id, ONBOARDING)
        db.table("experiment_assignments").upsert({
            "user_id": user_id, "experiment": ONBOARDING, "arm": arm, "bucket": bucket(user_id, ONBOARDING),
            "stratum": _stratum(db, user_id), "assigned_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id,experiment", ignore_duplicates=True).execute()
        return arm
    except Exception:
        log.warning("onboarding experiment unavailable; old flow", exc_info=True)
        return None


def arms_by_user(db, experiment: str = ONBOARDING) -> dict:
    """user_id -> arm, for the admin metrics. Empty before the migration runs."""
    try:
        rows = db.table("experiment_assignments").select("user_id, arm").eq("experiment", experiment).execute().data or []
    except Exception:
        return {}
    return {row["user_id"]: row["arm"] for row in rows}
