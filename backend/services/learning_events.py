"""Honest logging for the adaptive learning engine (phase 1): every answer and every format decision.

Rows hold raw values only. FSRS ratings, rapid-guess flags and memory state are derived later, so
learning_events.fsrs_rating stays null, rapid_guess false, arm 'fsrs' and params_version 'none'.
An idea is item_id '<guide_id>:<fingerprint>', the fingerprint being Learn's
(web/lib/learnEngine.mjs fingerprint).

Logging must never get in the way of studying: with LEARNING_EVENTS_ENABLED off, or before the
learning_events migration runs, write_batch does nothing and says so.
"""

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

PARAMS_VERSION = "none"
DEFAULT_ARM = "fsrs"
# Answers can reach the server late (a retry after a failed send, a phone that was offline).
MAX_EVENT_AGE = timedelta(days=7)
_FINGERPRINT = re.compile(r"[a-z0-9]+(?: [a-z0-9]+)*")
_missing_tables_logged = False


def learning_events_enabled() -> bool:
    return os.getenv("LEARNING_EVENTS_ENABLED", "false").strip().lower() in {"1", "true", "on", "yes"}


def fingerprint(question: str) -> str:
    """Same as learnEngine.fingerprint: the question lower-cased, runs of anything but a-z and 0-9
    as one space, trimmed, first 48 characters."""
    return re.sub(r"[^a-z0-9]+", " ", str(question or "").lower()).strip()[:48]


def valid_fingerprint(value: str) -> bool:
    # [:48] can leave a trailing space, so that's allowed too.
    return 0 < len(value) <= 48 and _FINGERPRINT.fullmatch(value.rstrip()) is not None


def item_id(guide_id: str, print_: str) -> str:
    return f"{guide_id}:{print_}"


def _utc(moment: Optional[datetime], now: datetime) -> datetime:
    """The time an answer was given: the client's time when believable, else now."""
    if moment is None:
        return now
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)
    if moment > now or now - moment > MAX_EVENT_AGE:
        return now
    return moment


def _local_day(moment: datetime, tz_offset: int):
    return (moment + timedelta(minutes=tz_offset)).date()


def _parse(ts) -> Optional[datetime]:
    try:
        moment = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def same_day_flags(events: list[dict], earlier: Iterable[dict], tz_offset: int) -> list[bool]:
    """For each event (item_id, occurred_at as UTC datetimes, in answer order): was the same idea
    already answered earlier on the same local day, before this batch or earlier in it?"""
    seen: dict[str, list[datetime]] = {}
    for row in earlier:
        moment = _parse(row.get("occurred_at"))
        if moment is not None:
            seen.setdefault(row["item_id"], []).append(moment)
    flags = []
    for event in events:
        moment = event["occurred_at"]
        day = _local_day(moment, tz_offset)
        before = [m for m in seen.get(event["item_id"], []) if m < moment]
        flags.append(any(_local_day(m, tz_offset) == day for m in before))
        seen.setdefault(event["item_id"], []).append(moment)
    return flags


def _missing_table(error: Exception) -> bool:
    text = str(error)
    return any(mark in text for mark in ("PGRST205", "42P01", "does not exist", "Could not find the table"))


def _note_failure(error: Exception) -> None:
    global _missing_tables_logged
    if _missing_table(error):
        if not _missing_tables_logged:
            logger.info("Learning events not logged: the learning_events migration hasn't run yet")
            _missing_tables_logged = True
        return
    logger.warning("Learning events not logged", exc_info=True)


def decision_row(user_id: str, decision: dict) -> dict:
    return {
        "id": decision["id"],
        "user_id": user_id,
        "session_id": decision.get("session_id"),
        "item_id": item_id(decision["guide_id"], decision["fingerprint"]),
        "decision_type": decision["decision_type"],
        "policy_version_id": decision["policy_version_id"],
        "source": decision["source"],
        "candidates": decision["candidates"],
        "mask_reasons": decision["mask_reasons"],
        "eligible": decision["eligible"],
        "probs": decision["probs"],
        "chosen": decision["chosen"],
        "propensity": decision["propensity"],
        "seed": decision["seed"],
        "context": decision["context"],
        "fsrs_before": None,
    }


def event_rows(user_id: str, events: list[dict], earlier: Iterable[dict], tz_offset: int, now: datetime) -> list[dict]:
    timed = [{**event, "item_id": item_id(event["guide_id"], event["fingerprint"]), "occurred_at": _utc(event.get("occurred_at"), now)}
             for event in events]
    order = sorted(range(len(timed)), key=lambda i: timed[i]["occurred_at"])
    flags = same_day_flags([timed[i] for i in order], earlier, tz_offset)
    same_day = {index: flag for index, flag in zip(order, flags)}
    rows = []
    for index, event in enumerate(timed):
        rows.append({
            "user_id": user_id,
            "item_id": event["item_id"],
            "guide_id": event["guide_id"],
            "decision_id": event.get("decision_id"),
            "mode": event["mode"],
            "format": event["format"],
            "outcome": event["outcome"],
            "confidence": event.get("confidence"),
            "first_key_ms": event.get("first_key_ms"),
            "submit_ms": event.get("submit_ms"),
            "hidden_ms": event.get("hidden_ms") or 0,
            "rapid_guess": False,
            "answer_chars": event.get("answer_chars"),
            "view_shown": event.get("view_shown"),
            "fsrs_rating": None,
            "same_day": same_day[index],
            "arm": DEFAULT_ARM,
            "params_version": PARAMS_VERSION,
            "occurred_at": event["occurred_at"].isoformat(),
        })
    return rows


def write_batch(supabase, user_id: str, decisions: list[dict], events: list[dict], tz_offset: int = 0) -> dict:
    """Saves one batch: decisions first (answers point at them), then answers.
    Returns {"logged": bool, "decisions": n, "events": n}; never raises."""
    if not learning_events_enabled():
        return {"logged": False, "decisions": 0, "events": 0}
    now = datetime.now(timezone.utc)
    try:
        if decisions:
            supabase.table("decision_events").upsert(
                [decision_row(user_id, decision) for decision in decisions], on_conflict="id", ignore_duplicates=True,
            ).execute()
        if not events:
            return {"logged": True, "decisions": len(decisions), "events": 0}
        # An answer whose decision never arrived (its batch was dropped) is kept without the link.
        sent = {decision["id"] for decision in decisions}
        wanted = {event["decision_id"] for event in events if event.get("decision_id")} - sent
        known = set(sent)
        if wanted:
            rows = supabase.table("decision_events").select("id").eq("user_id", user_id).in_("id", sorted(wanted)).execute().data or []
            known |= {row["id"] for row in rows}
        events = [{**event, "decision_id": event.get("decision_id") if event.get("decision_id") in known else None} for event in events]
        items = sorted({item_id(event["guide_id"], event["fingerprint"]) for event in events})
        since = (now - MAX_EVENT_AGE - timedelta(days=1)).isoformat()
        earlier = supabase.table("learning_events").select("item_id, occurred_at").eq("user_id", user_id) \
            .in_("item_id", items).gte("occurred_at", since).execute().data or []
        supabase.table("learning_events").insert(event_rows(user_id, events, earlier, tz_offset, now)).execute()
        return {"logged": True, "decisions": len(decisions), "events": len(events)}
    except Exception as error:
        _note_failure(error)
        return {"logged": False, "decisions": 0, "events": 0}
