"""Each connector's sync health and Cordia container, on connector_settings (one row per app).

Shown on the Connectors cards: when it last synced, what came in, and whether it needs reconnecting.
Alerts (a grade drop, a changed deadline) ride on stats["alerts"], newest first.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from database import get_supabase

log = logging.getLogger(__name__)
MAX_ALERTS = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get(user_id: str, connector: str) -> dict:
    try:
        rows = get_supabase().table("connector_settings").select("*").eq("user_id", user_id).eq("connector", connector).limit(1).execute().data
    except Exception as error:
        log.warning("connector_settings read failed: %s", error)
        return {}
    return (rows or [{}])[0]


def for_user(user_id: str) -> dict[str, dict]:
    try:
        rows = get_supabase().table("connector_settings").select("*").eq("user_id", user_id).execute().data or []
    except Exception as error:
        log.warning("connector_settings read failed: %s", error)
        return {}
    return {row["connector"]: row for row in rows}


def _write(user_id: str, connector: str, fields: dict) -> None:
    try:
        get_supabase().table("connector_settings").upsert(
            {"user_id": user_id, "connector": connector, **fields, "updated_at": _now()}, on_conflict="user_id,connector",
        ).execute()
    except Exception as error:
        log.warning("connector_settings write failed: %s", error)


def record(user_id: str, connector: str, *, stats: Optional[dict] = None, error: Optional[str] = None,
           needs_reconnect: bool = False) -> None:
    """After a sync: success clears the error; a failure keeps the last good time and says why."""
    fields: dict = {"last_error": (error or None) and error[:300], "needs_reconnect": needs_reconnect}
    if not error:
        fields["last_synced_at"] = _now()
    if stats is not None:
        fields["stats"] = {**(get(user_id, connector).get("stats") or {}), **stats}
    _write(user_id, connector, fields)


def set_container(user_id: str, connector: str, container_id: Optional[str]) -> None:
    _write(user_id, connector, {"container_id": container_id})


def claim(user_id: str, connector: str, last_synced_at: Optional[str]) -> bool:
    """Takes this user's next sync unless another worker already did (the time moved since it was read)."""
    db = get_supabase().table("connector_settings").update({"last_synced_at": _now()}).eq("user_id", user_id).eq("connector", connector)
    db = db.eq("last_synced_at", last_synced_at) if last_synced_at else db.is_("last_synced_at", "null")
    try:
        return bool(db.execute().data)
    except Exception as error:
        log.warning("sync claim failed: %s", error)
        return False


def add_alert(user_id: str, connector: str, alert: dict) -> None:
    stats = get(user_id, connector).get("stats") or {}
    alerts = [alert, *(stats.get("alerts") or [])][:MAX_ALERTS]
    _write(user_id, connector, {"stats": {**stats, "alerts": alerts}})


def dismiss_alert(user_id: str, connector: str, at: str) -> None:
    stats = get(user_id, connector).get("stats") or {}
    _write(user_id, connector, {"stats": {**stats, "alerts": [a for a in stats.get("alerts") or [] if a.get("at") != at]}})
