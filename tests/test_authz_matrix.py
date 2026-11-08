"""The authorization matrix (social plan, Stage 9), generated from the app's own routes.

1. Every route in a social router declares exactly one access.py dependency, so a new endpoint
   can't skip its visibility, membership or block check (it fails here instead).
2. Every such route is then called as each kind of viewer against each kind of target (private,
   held, blocked, archived, a minor with the strict rules on and off). Denied cases must answer
   401/403/404 from the access check; allowed cases must get past it.
"""

from pathlib import Path
import os
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")

from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import access  # noqa: E402
import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB, route_patches  # noqa: E402

SOCIAL_MODULES = {"routers.profiles", "routers.social", "routers.notifications", "routers.discover", "routers.classrooms",
                  "routers.guide_sharing", "routers.study", "routers.reports", "routers.public_forms"}
SOCIAL_ADMIN = {"decide_reports"}

U = {name: f"{i:08d}-0000-4000-8000-00000000000{i}" for i, name in enumerate(
    ["ana", "ben", "cat", "dan", "eve", "fay", "hel", "min"], start=1)}
GUIDE = {"private": "10000000-0000-4000-8000-000000000001", "public": "10000000-0000-4000-8000-000000000002",
         "held": "10000000-0000-4000-8000-000000000003"}
ROOM = {"group": "20000000-0000-4000-8000-000000000001", "held": "20000000-0000-4000-8000-000000000002",
        "public": "20000000-0000-4000-8000-000000000003", "archived": "20000000-0000-4000-8000-000000000004",
        "teach": "20000000-0000-4000-8000-000000000005", "unlisted": "20000000-0000-4000-8000-000000000006"}
INVITE = "30000000-0000-4000-8000-000000000001"
MISSING = "99999999-0000-4000-8000-000000000009"


def access_dependencies(route: APIRoute) -> list:
    found, stack = [], list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        if access.kind_of(dep.call):
            found.append(dep.call)
        stack.extend(dep.dependencies)
    return found


def all_routes(routes):
    """Every APIRoute, including those inside included routers (FastAPI keeps them wrapped)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from all_routes(route.original_router.routes)


def social_routes() -> list:
    return [r for r in all_routes(main.app.router.routes)
            if r.endpoint.__module__ in SOCIAL_MODULES or r.endpoint.__name__ in SOCIAL_ADMIN]


def build_db() -> FakeDB:
    db = FakeDB()
    for name, uid in U.items():
        db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title(), "profile_visibility": "public",
                                         "allow_follows": "everyone", "allow_friend_requests": "everyone",
                                         "review_status": "held" if name == "hel" else "ok", "is_minor": name == "min"})
    db.rows("user_blocks").append({"blocker_id": U["ana"], "blocked_id": U["cat"]})
    db.rows("app_admins").append({"user_id": U["eve"]})
    base = {"user_id": U["ana"], "title": "Notes", "notes": "", "study_guide": "Q1: What is a cell?\nA1: The unit of life.",
            "flashcards": [], "folder_id": None, "attribution": "named", "version": 1, "hold_reason": None,
            "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"}
    db.rows("study_guides").extend([
        {**base, "id": GUIDE["private"], "visibility": "private", "review_status": "ok"},
        {**base, "id": GUIDE["public"], "visibility": "public", "review_status": "ok"},
        {**base, "id": GUIDE["held"], "visibility": "public", "review_status": "held"},
    ])
    room = {"owner_id": U["ana"], "kind": "study_group", "visibility": "unlisted", "join_policy": "auto", "members_can_add": True,
            "members_can_invite": True, "archived_at": None, "review_status": "ok", "class_id": None, "description": None}
    db.rows("classrooms").extend([
        {**room, "id": ROOM["group"], "name": "Group"},
        {**room, "id": ROOM["held"], "name": "Held", "review_status": "held"},
        {**room, "id": ROOM["public"], "name": "Public", "visibility": "public"},
        {**room, "id": ROOM["archived"], "name": "Archived", "archived_at": "2026-11-01T00:00:00+00:00"},
        {**room, "id": ROOM["teach"], "name": "Teach", "kind": "instructor_class", "visibility": "public", "instructor_request": "approved"},
        {**room, "id": ROOM["unlisted"], "name": "Unlisted"},
    ])
    for key in ("group", "held", "archived", "teach"):
        db.rows("classroom_members").extend([
            {"classroom_id": ROOM[key], "user_id": U["ana"], "role": "owner", "status": "active"},
            {"classroom_id": ROOM[key], "user_id": U["fay"], "role": "instructor" if key == "teach" else "admin", "status": "active"},
            {"classroom_id": ROOM[key], "user_id": U["dan"], "role": "member", "status": "active"},
        ])
    db.rows("classroom_invites").append({"id": INVITE, "classroom_id": ROOM["group"], "token": "t" * 24, "short_code": "ABCDEFGH",
                                         "created_by": U["fay"], "uses": 0, "created_at": "2026-11-01T00:00:00+00:00"})
    return db


# (viewer, {param: value}, extra env, denied?) per access kind ----------------------------------------
def cases(kind: str, param: str, signed_in: bool) -> list:
    on = {"MINOR_SAFETY": "true"}
    if kind == "own":
        return [(None, {}, {}, True), ("ben", {}, {}, False)]
    if kind == "public":
        return [(None, {}, {}, False), ("ben", {}, {}, False)]
    if kind == "admin":
        return [(None, {}, {}, True), ("ben", {}, {}, True), ("eve", {}, {}, False)]
    if kind == "guide:own":
        return [(None, {param: GUIDE["private"]}, {}, True), ("ben", {param: GUIDE["private"]}, {}, True),
                ("ben", {param: GUIDE["public"]}, {}, True), ("ana", {param: GUIDE["private"]}, {}, False)]
    if kind in ("guide:view", "guide:study"):
        out = [("ben", {param: GUIDE["private"]}, {}, True), ("ben", {param: GUIDE["held"]}, {}, True),
               ("cat", {param: GUIDE["public"]}, {}, True), ("ben", {param: MISSING}, {}, True),
               ("ben", {param: GUIDE["public"]}, {}, False)]
        out.append((None, {param: GUIDE["public"]}, {}, signed_in))
        return out
    if kind in ("classroom:member", "classroom:staff", "classroom:owner"):
        out = [(None, {param: ROOM["group"]}, {}, True), ("ben", {param: ROOM["group"]}, {}, True),
               ("dan", {param: ROOM["held"]}, {}, True), ("dan", {param: ROOM["archived"]}, {}, True),
               ("ana", {param: ROOM["group"]}, {}, False), ("fay", {param: ROOM["held"]}, {}, kind == "classroom:owner")]
        out.append(("dan", {param: ROOM["group"]}, {}, kind != "classroom:member"))
        out.append(("fay", {param: ROOM["group"]}, {}, kind == "classroom:owner"))
        return out
    if kind == "classroom:instructor_staff":
        return [("ana", {param: ROOM["group"]}, {}, True), ("dan", {param: ROOM["teach"]}, {}, True),
                ("ben", {param: ROOM["teach"]}, {}, True), ("ana", {param: ROOM["teach"]}, {}, False),
                ("fay", {param: ROOM["teach"]}, {}, False)]
    if kind == "classroom:listed":
        return [("ben", {param: ROOM["public"]}, {}, False), ("ben", {param: ROOM["unlisted"]}, {}, True),
                ("ben", {param: ROOM["held"]}, {}, True), ("cat", {param: ROOM["public"]}, {}, True),
                ("min", {param: ROOM["teach"]}, on, True), ("min", {param: ROOM["teach"]}, {}, False),
                ("ben", {param: ROOM["teach"]}, on, False)]
    if kind == "classroom:leave":
        return [("ben", {param: ROOM["group"]}, {}, True), ("dan", {param: ROOM["held"]}, {}, False),
                ("dan", {param: ROOM["group"]}, {}, False)]
    if kind == "invite":
        return [("ben", {param: INVITE}, {}, True), ("dan", {param: INVITE}, {}, True), ("fay", {param: INVITE}, {}, False),
                ("ana", {param: INVITE}, {}, False), ("ben", {param: MISSING}, {}, True)]
    if kind == "person:reach":
        return [(None, {param: U["ben"]}, {}, True), ("ben", {param: U["ben"]}, {}, True), ("ana", {param: U["cat"]}, {}, True),
                ("cat", {param: U["ana"]}, {}, True), ("ben", {param: U["hel"]}, {}, True), ("ben", {param: MISSING}, {}, True),
                ("ben", {param: U["dan"]}, {}, False)]
    if kind == "person:block":
        return [("ben", {param: U["ben"]}, {}, True), ("ben", {param: MISSING}, {}, True), ("ana", {param: U["cat"]}, {}, False)]
    if kind == "profile":
        return [("cat", {param: "ana"}, {}, True), ("ben", {param: "hel"}, {}, True), ("ben", {param: "min"}, {}, True),
                ("ben", {param: "nobody99"}, {}, True), ("hel", {param: "hel"}, {}, False), ("ben", {param: "ana"}, {}, False)]
    raise AssertionError(f"No matrix cases for access kind {kind!r}: add them here")


DEFAULTS = {"guide_id": GUIDE["public"], "classroom_id": ROOM["group"], "target_id": U["dan"], "follower_id": U["dan"],
            "requester_id": U["dan"], "username": "dan", "invite_id": INVITE, "item_type": "guide", "item_id": GUIDE["public"],
            "class_id": MISSING, "token": "t" * 24, "target_type": "guide"}


class AuthorizationMatrixTests(unittest.TestCase):
    def setUp(self):
        self.db = build_db()
        names = {f"Bearer {name}": uid for name, uid in U.items()}

        def who(header):
            from fastapi import HTTPException
            if header not in names:
                raise HTTPException(status_code=401, detail="Sign in")
            return names[header]
        modules = sorted(m.split(".", 1)[1] for m in SOCIAL_MODULES) + ["admin", "classes"]
        self.patches = route_patches(modules, who, self.db)
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true", "PER_VIEWER_PROGRESS": "true"})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_every_social_route_declares_exactly_one_access_check(self):
        routes = social_routes()
        self.assertGreater(len(routes), 60, "the social routers should all be found")
        missing = [f"{sorted(r.methods)[0]} {r.path}" for r in routes if len(access_dependencies(r)) != 1]
        self.assertEqual(missing, [], "each social route needs exactly one access.py dependency")

    def test_the_matrix(self):
        checked = 0
        for route in social_routes():
            dep = access_dependencies(route)[0]
            kind, param = access.kind_of(dep), dep.param
            method = sorted(route.methods)[0]
            for viewer, params, env, denied in cases(kind, param, dep.signed_in):
                values = {**DEFAULTS, **params}
                path = re.sub(r"\{(\w+)(?::\w+)?\}", lambda m: values[m.group(1)], route.path)
                with self.subTest(route=f"{method} {route.path}", kind=kind, viewer=viewer, path=path, env=env):
                    rate_limit._hits.clear()
                    self.db.tables = build_db().tables  # a fresh world for every case, same object the patches hand out
                    with patch.dict(os.environ, env):
                        headers = {"Authorization": f"Bearer {viewer}"} if viewer else {}
                        response = self.client.request(method, path, headers=headers)
                    detail = (response.json() or {}).get("detail") if response.headers.get("content-type", "").startswith("application/json") else None
                    access_404 = response.status_code == 404 and detail in access.NOT_FOUND.values()
                    if denied:
                        self.assertIn(response.status_code, (400, 401, 403, 404), f"{viewer} should be refused: {response.text[:200]}")
                    else:
                        self.assertNotIn(response.status_code, (401, 403), f"{viewer} should get past the check: {response.text[:200]}")
                        self.assertFalse(access_404, f"{viewer} should get past the check: {response.text[:200]}")
                    checked += 1
        self.assertGreater(checked, 300)


if __name__ == "__main__":
    unittest.main()
