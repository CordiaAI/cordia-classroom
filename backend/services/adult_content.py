"""Crude humor in memory tricks: who may turn it on and whether it applies (feedback item 4).

A student may confirm they are 18 or older unless their account is marked as a minor
(user_profiles.is_minor) or as high school (education_level = 'high_school'). "Crude humor in
memory tricks" (learning_preferences.crude_humor) applies only while all of that still holds, so a
later minor or high-school flag switches it off without touching the stored choice. Anything
unreadable (including a database before migration 20261121120000) counts as not allowed.
"""

import logging

logger = logging.getLogger(__name__)


def _profile(db, user_id: str) -> dict:
    try:
        rows = db.table("user_profiles").select("is_minor, education_level, adult_confirmed_at").eq("id", user_id).limit(1).execute().data
    except Exception:
        logger.warning("Profile age fields unavailable", exc_info=True)
        return {"is_minor": True}
    return rows[0] if rows else {}


def _crude_choice(db, user_id: str) -> bool:
    try:
        rows = db.table("learning_preferences").select("crude_humor").eq("user_id", user_id).limit(1).execute().data
    except Exception:
        logger.warning("Crude humor preference unavailable", exc_info=True)
        return False
    return bool(rows and rows[0].get("crude_humor") is True)


def may_confirm(profile: dict) -> bool:
    return profile.get("is_minor") is not True and profile.get("education_level") != "high_school"


def status(db, user_id: str) -> dict:
    """What Settings › Tutor shows: whether to offer the 18+ confirmation, and the switch after it."""
    profile = _profile(db, user_id)
    can_confirm = may_confirm(profile)
    adult = can_confirm and bool(profile.get("adult_confirmed_at"))
    return {"can_confirm": can_confirm, "adult_confirmed": adult, "crude_humor": adult and _crude_choice(db, user_id)}


def crude_allowed(db, user_id: str) -> bool:
    return status(db, user_id)["crude_humor"]
