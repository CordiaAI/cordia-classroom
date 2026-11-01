"""Progress for connected apps (the MCP's get_progress), built from the same pieces the app's
Progress page uses: build_activity for minutes, best hours and quiz scores, streak_summary for the
streak, and build_insights for the question types that need work.
"""
from datetime import date

from routers.stats import build_activity

WEAK_BELOW = 80
MAX_WEAK = 5
MAX_TREND = 20


def _local_day(value: str, tz_offset: int):
    from routers.stats import _local_dt
    moment = _local_dt(value, tz_offset)
    return moment.date() if moment else None


def progress_summary(*, sessions: list, attempts: list, guides: dict, streak: dict, insights: dict,
                     today: date, tz_offset: int, since: date, course_id: str = "") -> dict:
    """What get_progress returns, for local days from `since` through `today`.

    course_id narrows minutes, scores and weak topics to that course's study sets (the streak
    is the student's, whatever they studied)."""
    if course_id:
        guides = {gid: row for gid, row in guides.items() if row.get("folder_id") == course_id}
        sessions = [row for row in sessions if row.get("guide_id") in guides]
        attempts = [row for row in attempts if row.get("guide_id") in guides]
    activity = build_activity(sessions, [], guides, {}, today, tz_offset)
    days = [day for day in activity["days"] if day["date"] >= str(since)]

    scored = []
    for row in attempts:
        day = _local_day(row.get("completed_at"), tz_offset)
        if day is None or day < since or not isinstance(row.get("score"), (int, float)):
            continue
        scored.append((day, row))
    scored.sort(key=lambda item: (item[0], str(item[1].get("completed_at") or "")))
    trend = [{"date": str(day), "accuracy": round(row["score"]), "study_set_id": row.get("guide_id"),
              "study_set": (guides.get(row.get("guide_id")) or {}).get("title") or "Quiz"}
             for day, row in scored[-MAX_TREND:]]

    by_set: dict = {}
    for day, row in scored:
        entry = by_set.setdefault(row.get("guide_id"), {"scores": [], "last": day})
        entry["scores"].append(row["score"])
        entry["last"] = max(entry["last"], day)
    weak = sorted(
        ({"topic": (guides.get(gid) or {}).get("title") or "Quiz", "accuracy": round(sum(e["scores"]) / len(e["scores"])),
          "last_seen": str(e["last"]), "study_set_id": gid, "attempts": len(e["scores"])}
         for gid, e in by_set.items() if gid in guides),
        key=lambda item: (item["accuracy"], item["last_seen"]))
    weak = [item for item in weak if item["accuracy"] < WEAK_BELOW][:MAX_WEAK]

    hours = sorted(((hour, minutes) for hour, minutes in enumerate(activity["hours"]) if minutes > 0), key=lambda item: -item[1])[:3]
    return {
        "since": str(since),
        "streak_days": int(streak.get("current_streak") or 0),
        "longest_streak_days": int(streak.get("longest_streak") or 0),
        "studied_today": bool(streak.get("studied_today")),
        "week": streak.get("week") or [],
        "active_study_minutes": sum(day["minutes"] for day in days),
        "daily_minutes": [{"date": day["date"], "minutes": day["minutes"]} for day in days],
        "quiz_accuracy_trend": trend,
        "best_study_hours": [{"hour": hour, "minutes": minutes} for hour, minutes in hours],
        "weak_topics": weak,
        "question_types_needing_work": [{"type": row["label"], "accuracy": row["accuracy"], "answered": row["total"]}
                                        for row in (insights or {}).get("needs_work", [])],
    }
