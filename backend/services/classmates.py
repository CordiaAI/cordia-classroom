"""Suggestions from a student's Canvas courses (social plan, Stage 8).

From the courses the student takes this term (class_memberships -> class_terms for the current term,
from Canvas sync, the calendar or added by hand):
  - classrooms: public classrooms linked to one of those courses that they aren't in yet
  - classmates: people in the same course this term who let classmates find them
Classmates are never suggested when they:
  - are the student, a friend already, or someone they already follow
  - blocked the student or were blocked by them (either way)
  - have a private profile, or no username yet
  - turned "Let classmates from my courses find me" off (user_profiles.find_by_classmates; it's on
    by default for adults and off by default for minors, so a minor shows only after opting in)
A student marked as a minor gets classroom suggestions only, never people.
"""

from __future__ import annotations

from services import minors
from services import social_graph as graph
from services.blocks import hidden_from
from services.class_catalog import term_for

MAX_CLASSROOMS = 6
MAX_CLASSMATES = 12
PROFILE_COLUMNS = "id,username,display_name,name,profile_visibility,allow_follows,allow_friend_requests,is_minor"


def findable(profile: dict) -> bool:
    """Whether classmates may find this person: their setting, else on for adults, off for minors."""
    value = profile.get("find_by_classmates")
    if value is None:
        return profile.get("is_minor") is not True
    return bool(value)


def current_courses(db, user_id: str) -> dict:
    """{class_term_id: {"class_id", "code"}} for the courses this person takes this term."""
    mine = [r["class_term_id"] for r in db.table("class_memberships").select("class_term_id").eq("user_id", user_id).execute().data or []]
    if not mine:
        return {}
    term = term_for()
    terms = [t for t in db.table("class_terms").select("id,class_id,term").in_("id", mine).execute().data or [] if t.get("term") == term]
    if not terms:
        return {}
    classes = {c["id"]: c for c in db.table("classes").select("id,course_code_normalized,display_name").in_("id", [t["class_id"] for t in terms]).execute().data or []}
    return {t["id"]: {"class_id": t["class_id"], "code": (classes.get(t["class_id"]) or {}).get("course_code_normalized") or (classes.get(t["class_id"]) or {}).get("display_name") or ""}
            for t in terms}


def _profiles(db, ids: list) -> list:
    if not ids:
        return []
    try:
        return db.table("user_profiles").select(PROFILE_COLUMNS + ",find_by_classmates").in_("id", ids).execute().data or []
    except Exception:  # before migration 20261124120000: everyone's default applies
        return db.table("user_profiles").select(PROFILE_COLUMNS).in_("id", ids).execute().data or []


def suggestions(db, user_id: str) -> dict:
    courses = current_courses(db, user_id)
    if not courses:
        return {"term": term_for(), "courses": [], "classrooms": [], "classmates": []}
    hidden = hidden_from(db, user_id)
    code_of = {c["class_id"]: c["code"] for c in courses.values()}

    # Classrooms for these courses that are listed on the course page.
    rooms = db.table("classrooms").select("id,name,kind,class_id,owner_id,join_policy,visibility,archived_at") \
        .in_("class_id", list(code_of)).eq("visibility", "public").execute().data or []
    mine = {m["classroom_id"]: m for m in db.table("classroom_members").select("classroom_id,status").eq("user_id", user_id).execute().data or []}
    room_rows = []
    for room in rooms:
        if room.get("archived_at") or room["owner_id"] in hidden:
            continue
        status = (mine.get(room["id"]) or {}).get("status")
        if status in ("active", "pending"):
            continue
        count = len(db.table("classroom_members").select("user_id").eq("classroom_id", room["id"]).eq("status", "active").execute().data or [])
        room_rows.append({"id": room["id"], "name": room["name"], "kind": room.get("kind") or "study_group", "course": code_of.get(room["class_id"]),
                          "join_policy": room.get("join_policy") or "auto", "member_count": count})
    room_rows.sort(key=lambda r: (r["kind"] != "instructor_class", -r["member_count"], r["name"].lower()))

    # Classmates: same course, this term.
    people = []
    if not minors.is_minor(db, user_id):
        shared = {}
        for row in db.table("class_memberships").select("user_id,class_term_id").in_("class_term_id", list(courses)).execute().data or []:
            uid = row["user_id"]
            if uid == user_id or uid in hidden:
                continue
            shared.setdefault(uid, set()).add(courses[row["class_term_id"]]["code"])
        friends = graph.friend_ids(db, user_id)
        following = {r["followee_id"] for r in db.table("follows").select("followee_id,status").eq("follower_id", user_id).execute().data or []}
        candidates = [uid for uid in shared if uid not in friends and uid not in following]
        for profile in _profiles(db, candidates[:500]):
            if not profile.get("username") or (profile.get("profile_visibility") or "public") == "private" or not findable(profile):
                continue
            minor = profile.get("is_minor") is True
            problem = graph.may_request_friend(db, user_id, profile)
            people.append({
                "user_id": profile["id"], "username": profile["username"], "display_name": graph.shown_name(profile) or "Someone",
                "initials": graph.initials(profile), "courses": sorted(shared[profile["id"]]),
                "can_follow": not minor, "follows_need_approval": (profile.get("allow_follows") or "everyone") == "approval",
                "can_friend": problem is None, "friend_note": problem,
            })
        people.sort(key=lambda p: (-len(p["courses"]), p["display_name"].lower()))
    return {"term": term_for(), "courses": sorted({c["code"] for c in courses.values() if c["code"]}),
            "classrooms": room_rows[:MAX_CLASSROOMS], "classmates": people[:MAX_CLASSMATES]}
