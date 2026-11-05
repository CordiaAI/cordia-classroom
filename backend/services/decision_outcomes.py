"""What happened after each adaptive decision (personalization plan step 0.3), written nightly.

For every logged decision (today: Learn's choice of question format) this records, once each:
- delayed_recall: the next recall-format answer (typed, free fill-in, written) on the same idea at
  least a day later, first try of that day, not backfilled. value 1 right, 0.5 partly, 0 wrong; a
  correct answer marked "Guess" is 0, since it isn't a recall win (owner decision G1).
- returned_within_48h: once 48 hours have passed, 1 if the student answered anything between 6 and
  48 hours after the decision (a later sitting, not the same one), else 0.
p_pred and residual stay empty until FSRS predicts recall (Phase 2). Rows are unique per decision
and outcome type, so running twice (or on two machines) writes nothing new.

Before the decision_outcomes migration runs, the job does nothing and logs that once.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.metrics import RECALL_FORMATS

log = logging.getLogger(__name__)

RECALL_DELAY = timedelta(days=1)
RETURN_FROM = timedelta(hours=6)
RETURN_UNTIL = timedelta(hours=48)
LOOKBACK = timedelta(days=35)     # decisions older than this with no recall yet are left alone
RUN_HOUR_UTC = 8                  # 3-4 a.m. US Eastern
PAGE = 1000
_last_run_day = None
_missing_logged = False


def _when(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _recall_value(event: dict) -> float:
    outcome = event.get("outcome")
    if outcome in ("right", "partly") and event.get("confidence") == "guess":
        return 0.0
    return {"right": 1.0, "partly": 0.5}.get(outcome, 0.0)


def outcomes_for(decisions: list[dict], events: list[dict], done: set, now: datetime) -> list[dict]:
    """decisions: {id, user_id, item_id, created_at}; events: learning_events rows {id, user_id,
    item_id, occurred_at, format, outcome, confidence, same_day, mode}; done: {(decision_id,
    outcome_type)} already written. Returns the new decision_outcomes rows."""
    by_item = defaultdict(list)
    by_user = defaultdict(list)
    for event in events:
        moment = _when(event.get("occurred_at"))
        if moment is None:
            continue
        event = {**event, "_at": moment}
        by_user[event["user_id"]].append(event)
        if event.get("item_id"):
            by_item[(event["user_id"], event["item_id"])].append(event)
    for rows in (*by_item.values(), *by_user.values()):
        rows.sort(key=lambda e: e["_at"])

    out = []
    for decision in decisions:
        made = _when(decision.get("created_at"))
        if made is None:
            continue
        base = {"decision_id": decision["id"], "user_id": decision["user_id"], "p_pred": None, "residual": None}
        if (decision["id"], "delayed_recall") not in done and decision.get("item_id"):
            for event in by_item.get((decision["user_id"], decision["item_id"]), []):
                if (event["_at"] >= made + RECALL_DELAY and event.get("format") in RECALL_FORMATS
                        and not event.get("same_day") and event.get("mode") != "backfill"):
                    out.append({**base, "outcome_type": "delayed_recall", "value": _recall_value(event),
                                "learning_event_id": event.get("id"), "observed_at": event["_at"].isoformat()})
                    break
        if (decision["id"], "returned_within_48h") not in done and now >= made + RETURN_UNTIL:
            came_back = any(made + RETURN_FROM <= e["_at"] <= made + RETURN_UNTIL for e in by_user.get(decision["user_id"], []))
            out.append({**base, "outcome_type": "returned_within_48h", "value": 1.0 if came_back else 0.0,
                        "learning_event_id": None, "observed_at": (made + RETURN_UNTIL).isoformat()})
    return out


def _all(query_for_page) -> list[dict]:
    rows, start = [], 0
    while True:
        page = query_for_page(start, start + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def run(db, now: Optional[datetime] = None) -> int:
    """Writes the outcomes that can be known now. Returns how many rows were written."""
    global _missing_logged
    now = now or datetime.now(timezone.utc)
    since = now - LOOKBACK
    try:
        done_rows = _all(lambda a, b: db.table("decision_outcomes").select("decision_id, outcome_type")
                         .gte("created_at", since.isoformat()).range(a, b))
    except Exception as error:
        if any(mark in str(error) for mark in ("PGRST205", "42P01", "does not exist", "Could not find the table")):
            if not _missing_logged:
                log.info("Decision outcomes not written: the decision_outcomes migration hasn't run yet")
                _missing_logged = True
            return 0
        raise
    done = {(row["decision_id"], row["outcome_type"]) for row in done_rows}
    decisions = _all(lambda a, b: db.table("decision_events").select("id, user_id, item_id, created_at")
                     .gte("created_at", since.isoformat()).lte("created_at", (now - RECALL_DELAY).isoformat())
                     .order("created_at").range(a, b))
    decisions = [d for d in decisions if (d["id"], "delayed_recall") not in done or (d["id"], "returned_within_48h") not in done]
    if not decisions:
        return 0
    users = sorted({d["user_id"] for d in decisions})
    events = []
    for start in range(0, len(users), 50):
        chunk = users[start:start + 50]
        events += _all(lambda a, b: db.table("learning_events")
                       .select("id, user_id, item_id, occurred_at, format, outcome, confidence, same_day, mode")
                       .in_("user_id", chunk).gte("occurred_at", since.isoformat()).range(a, b))
    rows = outcomes_for(decisions, events, done, now)
    for start in range(0, len(rows), 500):
        db.table("decision_outcomes").upsert(rows[start:start + 500], on_conflict="decision_id,outcome_type",
                                             ignore_duplicates=True).execute()
    return len(rows)


def run_if_due(db_factory, now: Optional[datetime] = None) -> None:
    """Once a day, from the sync worker's loop, at RUN_HOUR_UTC or later."""
    global _last_run_day
    now = now or datetime.now(timezone.utc)
    if now.hour < RUN_HOUR_UTC or _last_run_day == now.date():
        return
    _last_run_day = now.date()
    written = run(db_factory(), now)
    if written:
        log.info("decision outcomes written: %d", written)
