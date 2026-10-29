"""Slack for class and study-group workspaces, through Composio.

- Watch: the student picks up to 10 channels (stats.channels). Every 30 minutes Cordia reads what's
  new in them (stats.cursor: the newest message seen per channel) and keeps two kinds of post:
  1. ones that move a deadline ("exam moved to Thursday"): read with the student's real deadlines
     and saved as a pending change to confirm on the Dashboard, like email (mail_watch.propose);
  2. announcements about classwork (@channel / @here, or naming an exam, assignment, due date or
     a cancelled class): one Dashboard line each, with a link back to Slack.
  Only that line is kept, never the channel's history.
- Study sessions: post "who's in?" for a session to a channel, and optionally a reminder before it
  starts (stats.reminders, sent by the worker).
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state
from services.text_processing import mentions_date_change

log = logging.getLogger(__name__)
EVERY = timedelta(minutes=30)
MAX_CHANNELS = 10
MAX_ALERTS_PER_RUN = 3
CHANNEL_ID = re.compile(r"^[CG][A-Z0-9]{6,20}$")
SCHOOLWORK = re.compile(
    r"<!(?:channel|here|everyone)>|\b(?:exam|midterm|final|quiz|test|assignment|homework|hw|due|deadline|project|lab|reading|"
    r"class (?:is )?cancel(?:l?ed)?|no class|office hours|grades? (?:are )?(?:up|posted))\b", re.I)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(text: str) -> str:
    """Slack markup to plain words: <@U123> mentions, <!here>, <url|label> links."""
    text = re.sub(r"<!(here|channel|everyone)>", r"@\1", text or "")
    text = re.sub(r"<[@#][A-Z0-9]+(?:\|([^>]*))?>", lambda m: m.group(1) or "", text)
    text = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2", text)
    text = re.sub(r"<(https?://[^>]+)>", r"\1", text)
    return " ".join(text.split())


def channels(user_id: str, query: str = "") -> list[dict]:
    acct = composio.account_for(user_id, "slack")
    data = composio.run(acct, user_id, "SLACK_LIST_CONVERSATIONS", {"types": "public_channel,private_channel", "limit": 300, "exclude_archived": True})
    found = data.get("channels") or data.get("items") or []
    words = query.lower().split()
    out = [{"id": c.get("id"), "name": c.get("name") or "channel", "member": bool(c.get("is_member", True))}
           for c in found if isinstance(c, dict) and CHANNEL_ID.match(str(c.get("id") or ""))
           and all(w in str(c.get("name") or "").lower() for w in words)]
    out.sort(key=lambda c: (not c["member"], c["name"]))
    return out[:50]


def watched(user_id: str) -> list[dict]:
    return list((sync_state.get(user_id, "slack").get("stats") or {}).get("channels") or [])


def set_watched(user_id: str, picked: list[dict]) -> list[dict]:
    clean = []
    for c in picked[:MAX_CHANNELS]:
        cid = str(c.get("id") or "")
        if CHANNEL_ID.match(cid):
            clean.append({"id": cid, "name": str(c.get("name") or "channel")[:80]})
    stats = sync_state.get(user_id, "slack").get("stats") or {}
    # Start from now for newly watched channels, so old posts don't flood the Dashboard.
    cursor = {k: v for k, v in (stats.get("cursor") or {}).items() if any(c["id"] == k for c in clean)}
    for c in clean:
        cursor.setdefault(c["id"], f"{_now().timestamp():.6f}")
    sync_state.update_stats(user_id, "slack", {"channels": clean, "cursor": cursor, "watching": bool(clean)})
    return clean


def watch(user_id: str) -> dict:
    """One pass over the watched channels."""
    from services import mail_watch
    acct = composio.active_accounts(user_id).get("slack")
    if not acct:
        sync_state.record(user_id, "slack", error="Slack isn't connected anymore.", needs_reconnect=True)
        return {"checked": 0, "found": 0}
    stats = sync_state.get(user_id, "slack").get("stats") or {}
    cursor = dict(stats.get("cursor") or {})
    deadlines = None
    checked = found = posted = 0
    for channel in stats.get("channels") or []:
        oldest = cursor.get(channel["id"]) or f"{(_now() - timedelta(days=1)).timestamp():.6f}"
        try:
            data = composio.run(acct, user_id, "SLACK_FETCH_CONVERSATION_HISTORY", {"channel": channel["id"], "oldest": oldest, "limit": 50})
        except HTTPException:
            continue
        messages = sorted((m for m in data.get("messages") or [] if isinstance(m, dict) and m.get("ts")), key=lambda m: float(m["ts"]))
        for message in messages:
            cursor[channel["id"]] = max(cursor.get(channel["id"], "0"), str(message["ts"]), key=float)
            if message.get("subtype") in ("channel_join", "channel_leave", "bot_add", "channel_topic"):
                continue
            text = _clean(str(message.get("text") or ""))
            if len(text) < 12:
                continue
            checked += 1
            if mentions_date_change(text):
                deadlines = mail_watch.upcoming(user_id) if deadlines is None else deadlines
                saved = mail_watch.propose(user_id, source="slack", source_id=f"{channel['id']}:{message['ts']}",
                                           sender=f"#{channel['name']} (Slack)", subject="", text=text, deadlines=deadlines)
                found += saved
                if saved:
                    continue
            if SCHOOLWORK.search(str(message.get("text") or "")) and posted < MAX_ALERTS_PER_RUN:
                sync_state.add_alert(user_id, "slack", {
                    "kind": "slack_post", "channel": channel["name"], "title": text[:240], "at": _now().isoformat(),
                    "url": f"https://slack.com/app_redirect?channel={channel['id']}&message_ts={message['ts']}",
                })
                posted += 1
    sync_state.record(user_id, "slack", stats={"cursor": cursor, "posts_read": int(stats.get("posts_read") or 0) + checked,
                                               "date_changes": int(stats.get("date_changes") or 0) + found})
    return {"checked": checked, "found": found, "posted": posted}


def post_session(user_id: str, channel: dict, topic: str, when_iso: str, when_label: str, place: str = "",
                 remind_minutes: Optional[int] = None) -> dict:
    """Post a study session to a channel, and queue a reminder before it if asked."""
    if not CHANNEL_ID.match(str(channel.get("id") or "")):
        raise HTTPException(status_code=422, detail="Pick a channel.")
    try:
        when = datetime.fromisoformat(when_iso.replace("Z", "+00:00"))
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Pick a time.") from error
    if when.tzinfo is None or when < _now():
        raise HTTPException(status_code=422, detail="Pick a time that hasn't passed.")
    acct = composio.account_for(user_id, "slack")
    lines = [f"*Study session: {topic.strip()[:120]}*", f"When: {when_label.strip()[:80]}"]
    if place.strip():
        lines.append(f"Where: {place.strip()[:120]}")
    lines.append("Who's in? React or reply here.")
    composio.run(acct, user_id, "SLACK_SEND_MESSAGE", {"channel": channel["id"], "markdown_text": "\n".join(lines)})
    reminder = None
    if remind_minutes:
        at = when - timedelta(minutes=max(5, min(int(remind_minutes), 24 * 60)))
        if at > _now():
            stats = sync_state.get(user_id, "slack").get("stats") or {}
            reminder = {"channel": channel["id"], "name": str(channel.get("name") or "")[:80], "at": at.isoformat(),
                        "text": f"Reminder: study session for {topic.strip()[:120]} starts {when_label.strip()[:80]}" + (f" at {place.strip()[:120]}" if place.strip() else "") + "."}
            pending = sorted([*(stats.get("reminders") or []), reminder], key=lambda r: r["at"])[:20]
            sync_state.update_stats(user_id, "slack", {"reminders": pending, "next_reminder": pending[0]["at"]})
    return {"posted": True, "reminder_at": reminder["at"] if reminder else None}


def send_reminders(user_id: str, now: Optional[datetime] = None) -> int:
    now = now or _now()
    stats = sync_state.get(user_id, "slack").get("stats") or {}
    pending = list(stats.get("reminders") or [])
    due_now = [r for r in pending if r["at"] <= now.isoformat()]
    keep = [r for r in pending if r["at"] > now.isoformat()]
    # Claim them first (only if next_reminder hasn't moved), so two workers never post the same reminder.
    claimed = get_supabase().table("connector_settings").update({
        "stats": {**stats, "reminders": keep, "next_reminder": keep[0]["at"] if keep else None}, "updated_at": now.isoformat(),
    }).eq("user_id", user_id).eq("connector", "slack").eq("stats->>next_reminder", str(stats.get("next_reminder"))).execute().data
    if not claimed:
        return 0
    acct = composio.active_accounts(user_id).get("slack")
    sent = 0
    for reminder in due_now:
        # A reminder over an hour late (the worker was down) is dropped rather than sent.
        if acct and now - datetime.fromisoformat(reminder["at"]) < timedelta(hours=1):
            try:
                composio.run(acct, user_id, "SLACK_SEND_MESSAGE", {"channel": reminder["channel"], "markdown_text": reminder["text"]})
                sent += 1
            except HTTPException:
                log.info("slack reminder not sent")
    return sent


def due_reminders(now: datetime) -> list[str]:
    rows = get_supabase().table("connector_settings").select("user_id,stats").eq("connector", "slack") \
        .lte("stats->>next_reminder", now.isoformat()).limit(50).execute().data or []
    return [r["user_id"] for r in rows if (r.get("stats") or {}).get("next_reminder")]
