"""Deadline changes from school email (Gmail, Outlook) and Canvas announcements.

Opt-in per app ("Watch for date changes" on its Connectors card, stats.watch_dates). Every 30
minutes the worker reads the last two days of mail through Composio and keeps only:
1. mail from the student's school: its email domains (schools.email_domains, from the Canvas
   school) or any .edu address;
2. mail that mentions schoolwork timing at all (text_processing.mentions_date_change).
What's left goes to a small model with the student's real upcoming deadlines; a change it reports
must name one of those deadlines and a sane date, or it's dropped. Each change becomes a pending
deadline_changes row the student accepts or dismisses on the Dashboard. Only the extracted change
is stored, never the message.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from database import get_supabase
from services import composio, sync_state
from services.llm import read_date_change
from services.text_processing import html_to_text, mentions_date_change

log = logging.getLogger(__name__)
MAIL_APPS = ("gmail", "outlook")
EVERY = timedelta(minutes=30)
SEEN_KEEP = 400


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _time(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def school_domains(user_id: str) -> list[str]:
    db = get_supabase()
    rows = db.table("canvas_connections").select("school_id").eq("user_id", user_id).limit(1).execute().data or []
    school_id = rows[0].get("school_id") if rows else None
    if not school_id:
        return []
    school = (db.table("schools").select("email_domains").eq("id", school_id).limit(1).execute().data or [{}])[0]
    return [str(d).lower().lstrip("@") for d in school.get("email_domains") or [] if d]


def sender_address(sender: str) -> str:
    match = re.search(r"[\w.+-]+@([\w-]+\.)+[\w-]+", sender or "")
    return match.group(0).lower() if match else ""


def from_school(sender: str, domains: list[str]) -> bool:
    address = sender_address(sender)
    domain = address.split("@", 1)[1] if "@" in address else ""
    return bool(domain) and (domain.endswith(".edu") or any(domain == d or domain.endswith("." + d) for d in domains))


def _gmail(account: str, user_id: str) -> list[dict]:
    data = composio.run(account, user_id, "GMAIL_FETCH_EMAILS", {
        "query": "newer_than:2d -category:promotions -category:social", "max_results": 30, "include_payload": True,
    })
    out = []
    for m in data.get("messages") or []:
        sender = m.get("sender") or m.get("from") or ""
        out.append({"id": str(m.get("messageId") or m.get("id") or ""), "sender": str(sender), "subject": str(m.get("subject") or ""),
                    "text": str(m.get("messageText") or m.get("preview") or m.get("snippet") or ""), "at": m.get("messageTimestamp")})
    return out


def _outlook(account: str, user_id: str) -> list[dict]:
    data = composio.run(account, user_id, "OUTLOOK_LIST_MESSAGES", {
        "folder": "inbox", "top": 30, "select": ["id", "subject", "from", "body", "bodyPreview", "receivedDateTime"],
    })
    out = []
    for m in data.get("value") or data.get("messages") or []:
        sender = (m.get("from") or {}).get("emailAddress") or {} if isinstance(m.get("from"), dict) else {}
        body = (m.get("body") or {}).get("content") if isinstance(m.get("body"), dict) else ""
        out.append({"id": str(m.get("id") or ""), "sender": f"{sender.get('name') or ''} <{sender.get('address') or ''}>",
                    "subject": str(m.get("subject") or ""), "text": html_to_text(str(body or m.get("bodyPreview") or "")), "at": m.get("receivedDateTime")})
    return out


def upcoming(user_id: str) -> list[dict]:
    from routers.calendar import calendar_for  # The calendar router owns how deadlines are read.
    now = _now()
    return [i for i in calendar_for(user_id).get("items") or [] if not i.get("done") and _time(i.get("due_at"))
            and now - timedelta(days=1) <= _time(i["due_at"]) <= now + timedelta(days=120)]


def propose(user_id: str, *, source: str, source_id: str, sender: str, subject: str, text: str,
            deadlines: Optional[list] = None) -> int:
    """Read one message for deadline changes and save each as a pending suggestion."""
    deadlines = upcoming(user_id) if deadlines is None else deadlines
    if not deadlines:
        return 0
    by_key = {d["id"]: d for d in deadlines}
    now = _now()
    try:
        found = read_date_change(subject, sender, text, deadlines, now.date().isoformat())
    except Exception as error:
        log.info("date change read failed: %s", type(error).__name__)
        return 0
    saved = 0
    for change in found:
        item = by_key.get(str(change.get("item_key") or ""))
        kind = change.get("kind")
        if not item or kind not in ("moved", "extension", "cancelled"):
            continue
        new_due = _time(change.get("new_due")) if kind != "cancelled" else None
        if kind != "cancelled" and (not new_due or not now - timedelta(days=1) < new_due < now + timedelta(days=365)):
            continue  # A change needs a real, plausible date.
        if new_due and abs((new_due - _time(item["due_at"])).total_seconds()) < 60:
            continue  # Same date as now: nothing changes.
        row = {
            "user_id": user_id, "source": source, "source_id": source_id[:300], "item_key": item["id"], "kind": kind,
            "title": str(item.get("title") or "")[:300], "summary": str(change.get("summary") or "")[:600],
            "sender": (sender or "")[:300], "old_due": item["due_at"], "new_due": new_due.isoformat() if new_due else None,
        }
        try:
            get_supabase().table("deadline_changes").upsert(row, on_conflict="user_id,source,source_id,item_key", ignore_duplicates=True).execute()
            saved += 1
        except Exception as error:
            log.warning("deadline change not saved: %s", error)
    return saved


def watch(user_id: str, connector: str) -> dict:
    """One pass over the last two days of mail for one app."""
    state = sync_state.get(user_id, connector)
    stats = state.get("stats") or {}
    account = composio.active_accounts(user_id).get(connector)
    if not account:
        sync_state.record(user_id, connector, error=f"{connector.title()} isn't connected anymore.", needs_reconnect=True)
        return {"checked": 0, "found": 0}
    messages = _gmail(account, user_id) if connector == "gmail" else _outlook(account, user_id)
    seen = list(stats.get("seen") or [])
    domains = school_domains(user_id)
    deadlines = None
    checked = found = 0
    for message in messages:
        if not message["id"] or message["id"] in seen:
            continue
        seen.append(message["id"])
        if not from_school(message["sender"], domains) or not mentions_date_change(f"{message['subject']}\n{message['text']}"):
            continue
        deadlines = upcoming(user_id) if deadlines is None else deadlines
        checked += 1
        found += propose(user_id, source=connector, source_id=message["id"], sender=message["sender"], subject=message["subject"],
                         text=message["text"], deadlines=deadlines)
    sync_state.record(user_id, connector, stats={"seen": seen[-SEEN_KEEP:], "school_messages": int(stats.get("school_messages") or 0) + checked,
                                                 "date_changes": int(stats.get("date_changes") or 0) + found})
    return {"checked": checked, "found": found}


def due(now: datetime) -> list[dict]:
    cutoff = (now - EVERY).isoformat()
    return get_supabase().table("connector_settings").select("user_id,connector,last_synced_at").in_("connector", list(MAIL_APPS)) \
        .eq("stats->>watch_dates", "true").or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(20).execute().data or []
