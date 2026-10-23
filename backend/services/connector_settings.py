"""Whether each connected app is on for the Tutor and for Cordia Assistant (Settings > Connectors).

No row means both are on. Cordia Assistant reads the same table to leave switched-off apps out.
"""

import logging
from datetime import datetime, timezone

from database import get_supabase

log = logging.getLogger(__name__)
USES = ("tutor", "assistant")


def for_user(user_id: str) -> dict[str, dict[str, bool]]:
    """Connector id -> {"tutor": bool, "assistant": bool}, only for connectors with a saved row."""
    try:
        rows = get_supabase().table("connector_settings").select("connector,tutor,assistant").eq("user_id", user_id).execute().data or []
    except Exception as error:  # Before the migration runs everything stays on.
        log.warning("connector_settings read failed: %s", error)
        return {}
    return {row["connector"]: {use: bool(row.get(use, True)) for use in USES} for row in rows}


def uses(user_id: str, connector: str) -> dict[str, bool]:
    return for_user(user_id).get(connector) or {use: True for use in USES}


def save(user_id: str, connector: str, changes: dict[str, bool]) -> dict[str, bool]:
    merged = {**uses(user_id, connector), **{use: bool(value) for use, value in changes.items() if use in USES}}
    get_supabase().table("connector_settings").upsert({
        "user_id": user_id, "connector": connector, **merged, "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id,connector").execute()
    return merged
