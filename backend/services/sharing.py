"""Class sharing: snapshots, screening, near-duplicate grouping and ranking.

A shared set is a snapshot of a guide's title, guide text and cards only. Notes, Tutor
chats, progress and source files are never copied into it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from services.class_catalog import DUPLICATE_THRESHOLD, jaccard, screen_share, set_signature

logger = logging.getLogger(__name__)

SNAPSHOT_FIELDS = ("title", "study_guide", "flashcards")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cards(guide: dict) -> list:
    cards = guide.get("flashcards") or []
    return [{"front": str(c.get("front", ""))[:2000], "back": str(c.get("back", ""))[:4000]} for c in cards if isinstance(c, dict)]


def first_name(db, user_id: str) -> Optional[str]:
    try:
        user = db.auth.admin.get_user_by_id(user_id).user
        meta = getattr(user, "user_metadata", None) or {}
        name = str(meta.get("full_name") or meta.get("name") or "").strip()
        return name.split()[0][:40] if name else None
    except Exception:
        return None


def owner_name(db, user_id: str) -> Optional[str]:
    row = (db.table("sharing_settings").select("show_first_name").eq("user_id", user_id).limit(1).execute().data or [None])[0]
    return first_name(db, user_id) if row and row.get("show_first_name") else None


def _cluster_for(db, class_id: str, set_id: Optional[str], signature: set) -> Optional[str]:
    others = db.table("shared_sets").select("id,cluster_id,title,flashcards,status,visibility").eq("class_id", class_id).execute().data or []
    best, best_score = None, 0.0
    for other in others:
        if other["id"] == set_id or other.get("visibility") != "class" or other.get("status") not in ("visible", "held"):
            continue
        score = jaccard(signature, set_signature(other.get("title") or "", other.get("flashcards") or []))
        if score > best_score:
            best, best_score = other, score
    if best and best_score >= DUPLICATE_THRESHOLD:
        return best.get("cluster_id") or best["id"]
    return None


def upsert_share(db, user_id: str, guide: dict, class_id: str, visibility: str) -> dict:
    """Create or update the snapshot for a guide and set its visibility."""
    existing = (db.table("shared_sets").select("*").eq("guide_id", guide["id"]).limit(1).execute().data or [None])[0]
    cards = _cards(guide)
    title = (guide.get("title") or "Untitled")[:300]
    text = (guide.get("study_guide") or "")[:200_000]
    hold = screen_share(title, text, cards) if visibility == "class" else None
    row = {
        "guide_id": guide["id"], "owner_id": user_id, "class_id": class_id, "visibility": visibility,
        "title": title, "study_guide": text, "flashcards": cards, "card_count": len(cards),
        "owner_name": owner_name(db, user_id), "updated_at": _now(),
    }
    if existing:
        changed = any(existing.get(k) != row[k] for k in ("title", "study_guide", "flashcards"))
        row["version"] = int(existing.get("version") or 1) + (1 if changed else 0)
        # Moderation outcomes stick: a hidden or taken-down set stays down until an admin acts.
        if existing.get("status") in ("hidden", "taken_down"):
            row["status"] = existing["status"]
        else:
            row["status"] = "held" if hold else "visible"
            row["hold_reason"] = hold
        if existing.get("class_id") != class_id:
            row["cluster_id"] = None
    else:
        row["status"] = "held" if hold else "visible"
        row["hold_reason"] = hold
    if visibility == "class" and row.get("status") == "visible":
        row["cluster_id"] = _cluster_for(db, class_id, existing["id"] if existing else None, set_signature(title, cards))
    saved = (db.table("shared_sets").upsert(row, on_conflict="guide_id").execute().data or [None])[0] or {**(existing or {}), **row}
    if saved.get("id") and not saved.get("cluster_id"):
        db.table("shared_sets").update({"cluster_id": saved["id"]}).eq("id", saved["id"]).execute()
        saved["cluster_id"] = saved["id"]
    return saved


def on_guide_changed(db, user_id: str, guide_id: str) -> None:
    """Owner edited a guide: refresh its snapshot so saved copies show "Update available"."""
    try:
        shared = (db.table("shared_sets").select("class_id,visibility").eq("guide_id", guide_id).eq("owner_id", user_id).limit(1).execute().data or [None])[0]
        if not shared:
            return
        guide = (db.table("study_guides").select("id,title,study_guide,flashcards").eq("id", guide_id).eq("user_id", user_id).limit(1).execute().data or [None])[0]
        if guide:
            upsert_share(db, user_id, guide, shared["class_id"], shared["visibility"])
    except Exception as exc:
        logger.warning(f"Shared set refresh failed: {type(exc).__name__}")


def ranked_entries(db, sets: list[dict], viewer_id: str) -> list[dict]:
    """Rank by studiers, then average accuracy, then recency; group near-duplicates."""
    ids = [s["id"] for s in sets]
    studiers = db.table("shared_set_studiers").select("set_id,accuracy").in_("set_id", ids).execute().data or [] if ids else []
    stats = {}
    for row in studiers:
        entry = stats.setdefault(row["set_id"], [0, 0.0, 0])
        entry[0] += 1
        if row.get("accuracy") is not None:
            entry[1] += float(row["accuracy"])
            entry[2] += 1
    saved = set()
    if ids:
        saved = {g["linked_set_id"] for g in db.table("study_guides").select("linked_set_id").eq("user_id", viewer_id).in_("linked_set_id", ids).execute().data or []}

    def view(s):
        count, total, n = stats.get(s["id"], [0, 0.0, 0])
        return {
            "id": s["id"], "title": s.get("title"), "card_count": s.get("card_count") or 0, "studied_by": count,
            "accuracy": round(total / n) if n else None, "updated_at": s.get("updated_at"), "owner_name": s.get("owner_name"),
            "mine": s.get("owner_id") == viewer_id, "saved": s["id"] in saved, "version": s.get("version") or 1,
        }

    views = sorted((view(s) | {"_cluster": s.get("cluster_id") or s["id"]} for s in sets),
                   key=lambda v: (v["studied_by"], v["accuracy"] or 0, v["updated_at"] or ""), reverse=True)
    groups: dict[str, list] = {}
    for v in views:
        groups.setdefault(v.pop("_cluster"), []).append(v)
    return [{**versions[0], "versions": versions} for versions in groups.values()]
