"""First-touch attribution saved with sign-up (web/lib/attribution.mjs sends it with POST /auth/age).

Where a new student first came from: the public page they landed on, the referring host, campaign
tags, Cordia's own ?from= value and the AI assistant that sent them, if any. No personal data.

Only the keys below are kept (anything else is dropped), each with a type and a length cap, and the
whole object is capped again in the database. The write needs user_profiles.acquisition
(migration 20261129120000_user_profiles_acquisition.sql), so it stays off until
ACQUISITION_TRACKING is turned on after that migration is applied. A first touch is never
overwritten, and a failed write never fails sign-up.
"""
import json
import logging
import os
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = logging.getLogger(__name__)

AI_ENGINES = ("chatgpt", "perplexity", "gemini", "copilot", "claude", "bing_chat")
MAX_BYTES = 2048  # the same cap as the column's check constraint


def enabled() -> bool:
    """Saving first-touch attribution (needs migration 20261129120000; off until it's applied)."""
    return os.getenv("ACQUISITION_TRACKING", "").strip().lower() in ("1", "true", "yes", "on")


class Acquisition(BaseModel):
    """The allowlisted first-touch fields. Unknown keys are ignored, not stored."""
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    landing_path: Optional[str] = Field(default=None, max_length=200, pattern=r"^/[A-Za-z0-9/_\-.]*$")
    referrer_host: Optional[str] = Field(default=None, max_length=255, pattern=r"^[a-z0-9.\-]+$")
    utm_source: Optional[str] = Field(default=None, max_length=100)
    utm_medium: Optional[str] = Field(default=None, max_length=100)
    utm_campaign: Optional[str] = Field(default=None, max_length=100)
    # Cordia's own ?from= value (use-case pages link to /signup?from=<slug>).
    from_: Optional[str] = Field(default=None, alias="from", max_length=64, pattern=r"^[a-z0-9-]+$")
    ai_engine: Optional[Literal[AI_ENGINES]] = None
    first_seen: Optional[date] = None

    def stored(self) -> Optional[dict]:
        """The JSON to keep: set fields only, campaign tags without control characters; None if empty."""
        data = self.model_dump(by_alias=True, exclude_none=True, mode="json")
        for key in ("utm_source", "utm_medium", "utm_campaign"):
            if key in data:
                data[key] = "".join(ch for ch in data[key] if ch.isprintable()) or None
        data = {key: value for key, value in data.items() if value}
        return data or None


FIELDS = ("landing_path", "referrer_host", "utm_source", "utm_medium", "utm_campaign", "from", "ai_engine", "first_seen")


def parse(raw) -> Optional[Acquisition]:
    """The valid allowlisted fields of whatever the browser sent; a bad field is dropped on its own,
    so attribution can never make sign-up fail."""
    if not isinstance(raw, dict):
        return None
    kept = {}
    for key in FIELDS:
        if key not in raw:
            continue
        try:
            Acquisition.model_validate({key: raw[key]})
        except ValidationError:
            continue
        kept[key] = raw[key]
    return Acquisition.model_validate(kept) if kept else None


def save(supabase, user_id: str, raw) -> bool:
    """Keeps the first touch on the student's profile once. True if a row was written."""
    if not enabled():
        return False
    acquisition = parse(raw)
    if not acquisition:
        return False
    data = acquisition.stored()
    if not data or len(json.dumps(data).encode()) > MAX_BYTES:
        return False
    try:
        result = (
            supabase.table("user_profiles").update({"acquisition": data})
            .eq("id", user_id).is_("acquisition", "null").execute()
        )
        return bool(result.data)
    except Exception:
        # Before the migration (or any other write problem): sign-up carries on without it.
        logger.warning("First-touch attribution not saved", exc_info=True)
        return False
