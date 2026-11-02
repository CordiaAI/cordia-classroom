"""Study sets built in the background (generation_jobs), on the always-on Fly machine.

A job is a row in generation_jobs:
- the app's New sheet and lecture page queue one with POST /study-set-jobs (routers/jobs.py);
- a connected app queues one with its own token through queue_study_set_job(), so the row is
  created under the student's Row Level Security (routers/mcp.py POST /mcp/study-sets).
The worker claims queued rows with a conditional update (two machines never run the same job),
then builds the set with the same code as POST /generate and POST /guides
(routers/materials.build_materials, routers/guides.create_guide) and the same plan check and charge
(services/entitlements require/record, keyed by the job id so a retry is never charged twice).

Why the worker uses the service role: building a set reads the plan, charges usage and saves the
guide, all service-role operations in the app too. It acts only for the user_id on the job row,
which the student's own request created. A connected app's link is fetched by services/url_fetch
(public addresses only, never an LMS).

On by default on Fly (FLY_APP_NAME is set there), off elsewhere; GENERATION_WORKER=1 or 0 overrides.
"""

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from database import get_supabase

log = logging.getLogger(__name__)
POLL_SECONDS = 2
WORKERS = 2
STALE_AFTER = timedelta(minutes=20)   # a job running this long was lost with its machine
MAX_ATTEMPTS = 2
MAX_CONTENT_LENGTH = 500_000
ESTIMATED_SECONDS = 90
GENERIC_ERROR = "Cordia couldn't make this study set. Try again in a moment."
_started = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update(job_id: str, changes: dict) -> None:
    get_supabase().table("generation_jobs").update({**changes, "updated_at": _now()}).eq("id", job_id).execute()


def fail(job_id: str, message: str) -> None:
    _update(job_id, {"status": "failed", "error": message[:500], "finished_at": _now(), "input": None})


def claim_next():
    """The oldest queued job, now marked running, or None."""
    db = get_supabase()
    rows = db.table("generation_jobs").select("id,attempts").eq("status", "queued").order("created_at").limit(5).execute().data or []
    for row in rows:
        claimed = db.table("generation_jobs").update({
            "status": "running", "attempts": (row.get("attempts") or 0) + 1, "started_at": _now(), "updated_at": _now(), "progress": 0.05,
        }).eq("id", row["id"]).eq("status", "queued").execute().data
        if claimed:
            return claimed[0]
    return None


def recover_stale() -> None:
    """Jobs whose machine stopped mid-build go back in the queue once, then fail."""
    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - STALE_AFTER).isoformat()
    for row in db.table("generation_jobs").select("id,attempts").eq("status", "running").lt("started_at", cutoff).limit(20).execute().data or []:
        if (row.get("attempts") or 0) < MAX_ATTEMPTS:
            db.table("generation_jobs").update({"status": "queued", "updated_at": _now()}).eq("id", row["id"]).eq("status", "running").execute()
        else:
            fail(row["id"], GENERIC_ERROR)


def _source_from_link(user_id: str, url: str) -> tuple:
    """(text, title, source_url) for a connected app's link: a web page or a linked document."""
    from routers.materials import readable_text
    from services import url_fetch
    from services.text_processing import page_text
    page = url_fetch.fetch(url)
    kind = page["content_type"]
    name = page["url"].rstrip("/").split("/")[-1].split("?")[0] or "Linked file"
    if "html" in kind or "xml" in kind:
        title, text = page_text(page["body"].decode("utf-8", errors="replace"))
    elif kind.startswith("text/plain"):
        title, text = "", page["body"].decode("utf-8", errors="replace")
    elif any(mark in kind for mark in ("pdf", "officedocument", "msword", "presentation")) or name.lower().endswith((".pdf", ".docx", ".pptx")):
        extension = "pdf" if "pdf" in kind else "pptx" if "presentation" in kind else "docx" if "word" in kind else name.rsplit(".", 1)[-1]
        title, text = name.rsplit(".", 1)[0], readable_text(user_id, f"{name.rsplit('.', 1)[0]}.{extension}", page["body"])["text"]
    else:
        raise url_fetch.UnsafeUrl("That link isn't a page or document Cordia can read. Paste its text instead.")
    if len(text.strip()) < 40:
        raise url_fetch.UnsafeUrl("Cordia found almost no text on that page. Paste its text instead.")
    from urllib.parse import urlsplit
    return text, (title or urlsplit(page["url"]).hostname or "Linked page"), page["url"]


def _request_for(job: dict) -> tuple:
    """(SaveGuideRequest fields, source text, what to build) from the job's input."""
    data = job.get("input") or {}
    user_id = job["user_id"]
    if job.get("source") == "mcp":
        outputs = data.get("outputs") or ["notes", "study_guide", "flashcards"]
        if data.get("kind") == "url":
            text, page_title, url = _source_from_link(user_id, data.get("url") or "")
            fields = {"title": job.get("title") or page_title, "keep_title": bool(job.get("title")), "source_type": "webpage",
                      "source_title": page_title[:500], "source_url": url}
        else:
            text = data.get("text") or ""
            fields = {"title": job.get("title") or "Study set", "keep_title": bool(job.get("title")), "source_type": "text"}
        build = {"notes": "notes" in outputs, "study_guide": True, "flashcards": "flashcards" in outputs}
    else:
        text = data.get("content") or ""
        fields = {key: data.get(key) for key in ("title", "keep_title", "source_type", "source_title", "source_url", "external_source_id") if data.get(key) is not None}
        fields.setdefault("title", job.get("title") or "Study guide")
        if data.get("external_source_id"):
            fields["source_id"] = data["external_source_id"]
        build = {"notes": data.get("notes", True), "study_guide": True, "flashcards": data.get("flashcards", True)}
    if job.get("folder_id"):
        fields["folder_id"] = job["folder_id"]
    return fields, text[:MAX_CONTENT_LENGTH], build


def run(job: dict) -> None:
    from routers.guides import SaveGuideRequest, create_guide
    from routers.materials import build_materials
    from services import url_fetch
    from services.entitlements import LimitReached, record, require
    job_id, user_id = job["id"], job["user_id"]
    try:
        fields, text, build = _request_for(job)
        if len(text.strip()) < 10:
            raise HTTPException(status_code=422, detail="Not enough text to build a study set.")
        _update(job_id, {"progress": 0.15})
        require(user_id, "guide")
        built = build_materials(user_id, text, [], build["notes"], build["study_guide"], build["flashcards"])
        if built["empty"]:
            raise HTTPException(status_code=422, detail="Cordia found no study material in this text.")
        record(user_id, "guide", f"job:{job_id}")
        _update(job_id, {"progress": 0.85})
        extra = {"origin": "mcp", "origin_client": job.get("client_name")} if job.get("source") == "mcp" else None
        guide = create_guide(user_id, SaveGuideRequest(**fields, notes=built["notes"], study_guide=built["study_guide"], flashcards=built["flashcards"]), extra)
        _update(job_id, {"status": "done", "progress": 1, "study_set_id": guide["id"], "finished_at": _now(), "input": None, "error": None})
    except LimitReached as error:
        fail(job_id, error.detail.get("message") if isinstance(error.detail, dict) else str(error.detail))
    except url_fetch.UnsafeUrl as error:
        fail(job_id, str(error))
    except HTTPException as error:
        detail = error.detail.get("message") if isinstance(error.detail, dict) else error.detail
        fail(job_id, str(detail or GENERIC_ERROR))
    except Exception as error:
        log.warning("study set job failed: %s", type(error).__name__)
        fail(job_id, GENERIC_ERROR)


def _loop() -> None:
    pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="study-set")
    busy = threading.Semaphore(WORKERS)
    last_recovery = 0.0
    while True:
        try:
            if time.monotonic() - last_recovery > 300:
                last_recovery = time.monotonic()
                recover_stale()
            while busy.acquire(blocking=False):
                job = claim_next()
                if not job:
                    busy.release()
                    break

                def work(claimed=job):
                    try:
                        run(claimed)
                    finally:
                        busy.release()
                pool.submit(work)
        except Exception:
            log.exception("study set worker tick failed")
        time.sleep(POLL_SECONDS)


def start() -> None:
    global _started
    if _started or os.getenv("GENERATION_WORKER", "1" if os.getenv("FLY_APP_NAME") else "0") != "1":
        return
    _started = True
    threading.Thread(target=_loop, name="study-set-worker", daemon=True).start()
