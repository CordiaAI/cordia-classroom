"""Local API for the Canvas/classes browser test. In-memory database, mocked Canvas, fake auth.

Runs the real canvas/classes/sharing routers. Never talks to Supabase or a real Canvas.
Usage: python tests/e2e/canvas_test_server.py  (listens on 127.0.0.1:8100)
"""
import base64
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tests")]
os.environ["CANVAS_TOKEN_KEY"] = base64.b64encode(b"e2e-only-key-e2e-only-key-e2e-ok"[:32]).decode()
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:1")

import uvicorn  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from fake_supabase import FakeDB  # noqa: E402
from test_canvas_integration import FakeCanvas  # noqa: E402
from routers import admin, calendar, canvas, classes, public_forms  # noqa: E402
from services import canvas_client  # noqa: E402

DB = FakeDB()
CANVAS = FakeCanvas()


def user_from_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    try:
        payload = authorization[7:].split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


for module in (canvas, classes, admin, public_forms, calendar):
    module.get_user_id = user_from_token
    module.get_supabase = lambda: DB
canvas_client.requests.Session = lambda: CANVAS
canvas_client._public_addresses = lambda host: ['203.0.113.10']
CANVAS.mount = lambda prefix, adapter: None  # the real client pins its session; the fake has nothing to pin

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for router in (canvas.router, classes.router, admin.router, public_forms.router):
    app.include_router(router)


@app.post("/__test/seed")
async def seed(request: Request):
    body = await request.json()
    DB.tables.clear()
    for table, rows in body.items():
        DB.rows(table).extend(rows)
    return {"ok": True}


@app.get("/__test/guide/{guide_id}")
def guide(guide_id: str):
    row = next((g for g in DB.rows("study_guides") if g["id"] == guide_id), None)
    if not row:
        raise HTTPException(status_code=404)
    return {"guide": {**row, "created_at": "2026-10-15T00:00:00Z", "read_progress": 0, "flashcard_progress": {}}}


@app.get("/__test/tables")
def tables():
    return {name: rows for name, rows in DB.tables.items() if name != "canvas_tokens"} | {"canvas_tokens_count": len(DB.rows("canvas_tokens")), "canvas_tokens": DB.rows("canvas_tokens")}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8100")), log_level="warning")
