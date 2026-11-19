"""Routes for connected apps (the MCP server at classroom.cordiacode.com/mcp). These are the only
backend routes that accept a connected app's token, and only that kind (auth_utils.verify_mcp_token).
They read as the student, through a Supabase client built with that token, so Row Level Security
and the connected-app role decide what they see. They call the same functions the app's routes do.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from auth_utils import verify_mcp_token
from database import get_student_supabase
from ids import is_uuid
from rate_limit import ai_rate_limit, limiter
from routers.stats import _graded_items, _student_results, activity_rows, streak_summary
from services.mcp_progress import progress_summary

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _student(authorization: str):
    """(user_id, client acting as the student) for a connected app that is still connected."""
    user_id, token = verify_mcp_token(authorization)
    db = get_student_supabase(token)
    try:
        active = db.rpc("mcp_session_check").execute().data
    except Exception:
        raise HTTPException(status_code=503, detail="Cordia could not check this connection")
    if active is not True:
        raise HTTPException(status_code=401, detail="This app was disconnected from Cordia")
    return user_id, db


def _time_zone(db, user_id: str) -> ZoneInfo:
    try:
        rows = db.table("user_profiles").select("timezone").eq("id", user_id).limit(1).execute().data or []
        return ZoneInfo(rows[0]["timezone"]) if rows and rows[0].get("timezone") else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def _progress(authorization: str, since: str, course_id: str) -> dict:
    user_id, db = _student(authorization)
    zone = _time_zone(db, user_id)
    now = datetime.now(timezone.utc).astimezone(zone)
    tz_offset = int(now.utcoffset().total_seconds() // 60)
    today = now.date()
    try:
        start = date.fromisoformat(since) if since else today - timedelta(days=29)
    except ValueError:
        raise HTTPException(status_code=422, detail="since must be YYYY-MM-DD")
    start = max(min(start, today), today - timedelta(days=366))
    sessions, attempts, guides = activity_rows(db, user_id, attempts_limit=500)
    data = _student_results(user_id, db)
    results, _ = _graded_items(data)
    from services.study_insights import build_insights
    summary = progress_summary(
        sessions=sessions, attempts=attempts, guides=guides, streak=streak_summary(db, user_id, tz_offset),
        insights=build_insights(results, data["sessions"]), today=today, tz_offset=tz_offset, since=start,
        course_id=course_id or "",
    )
    summary["time_zone"] = zone.key
    return summary


@router.get("/progress")
async def get_progress(authorization: str = Header(default=""), since: str = Query(default="", max_length=10),
                       course_id: Optional[str] = Query(default=None, max_length=36)):
    """Streak, active minutes, quiz accuracy, best hours and weak spots, as the app's Progress page
    counts them, from `since` (the student's local date) through today."""
    if course_id and not is_uuid(course_id):
        raise HTTPException(status_code=422, detail="course_id must be an id")
    return await run_in_threadpool(_progress, authorization, since, course_id or "")


# Errors the connected-app functions raise (supabase/migrations/20261102120000_mcp_write_tools.sql).
_DB_ERRORS = {"22023": 422, "54000": 429, "P0002": 404, "28000": 401, "42501": 403}


def _db_error(error: Exception) -> HTTPException:
    code = getattr(error, "code", "") or ""
    message = getattr(error, "message", "") or ""
    if code in _DB_ERRORS:
        return HTTPException(status_code=_DB_ERRORS[code], detail=message[:300] or "Cordia couldn't do that.")
    return HTTPException(status_code=503, detail="Cordia couldn't reach your Library right now. Try again shortly.")


class StudySetSource(BaseModel):
    type: Literal["text", "url"]
    text: Optional[str] = Field(default=None, max_length=200_000)
    url: Optional[str] = Field(default=None, max_length=2048)


class StudySetRequest(BaseModel):
    source: StudySetSource
    title: Optional[str] = Field(default=None, max_length=200)
    course_id: Optional[str] = None
    outputs: Optional[list[Literal["notes", "study_guide", "flashcards"]]] = Field(default=None, max_length=3)

    @field_validator("course_id")
    @classmethod
    def valid_course(cls, value):
        if value and not is_uuid(value):
            raise ValueError("course_id must be an id")
        return value or None


def _queue_study_set(authorization: str, body: StudySetRequest) -> dict:
    from services import url_fetch
    from services.entitlements import LimitReached, require
    user_id, db = _student(authorization)
    if body.source.type == "url":
        try:
            _, host, _, _ = url_fetch.check_url(body.source.url or "")
            url_fetch.public_addresses(host)
        except url_fetch.UnsafeUrl as error:
            raise HTTPException(status_code=422, detail=str(error))
    try:
        job_id = db.rpc("queue_study_set_job", {
            "source_kind": body.source.type, "source_text": body.source.text if body.source.type == "text" else None,
            "source_url": body.source.url if body.source.type == "url" else None, "title": body.title,
            "course": body.course_id, "outputs": body.outputs,
        }).execute().data
    except Exception as error:
        raise _db_error(error)
    # The plan's monthly study sets, checked for the student on the job row their own token created.
    rows = db.table("generation_jobs").select("id,user_id,status").eq("id", job_id).limit(1).execute().data or []
    if not rows or rows[0]["user_id"] != user_id:
        raise HTTPException(status_code=503, detail="The study set could not be queued.")
    status = rows[0].get("status") or "queued"
    # A repeated request gets back the job already made for it (queue_study_set_job), which may be
    # running or done: only a job still waiting is checked against the plan.
    if status == "queued":
        try:
            require(rows[0]["user_id"], "guide")
        except LimitReached as error:
            from services.generation_jobs import fail
            fail(rows[0]["id"], error.detail["message"])
            raise
    return {"job_id": job_id, "status": status}


@router.post("/study-sets")
@limiter.limit("20/minute")
async def queue_study_set(body: StudySetRequest, request: Request, authorization: str = Header(default="")):
    """Queue a study set from text or a link; services/generation_jobs builds it in the background."""
    if body.source.type == "text" and not (body.source.text or "").strip():
        raise HTTPException(status_code=422, detail="Send the text to build from")
    if body.source.type == "url" and not body.source.url:
        raise HTTPException(status_code=422, detail="Send the link to build from")
    return await run_in_threadpool(_queue_study_set, authorization, body)


class AnswerEvent(BaseModel):
    """One answer given in a connected app, for the learning log (services/learning_events)."""
    guide_id: str = Field(..., pattern=r"^[0-9a-fA-F-]{36}$")
    fingerprint: str = Field(..., min_length=1, max_length=48)
    format: Literal["flashcard", "typed", "practice"]
    outcome: Literal["right", "wrong", "got_it", "again"]
    confidence: Optional[Literal["sure", "think_so", "guess"]] = None
    answer_chars: Optional[int] = Field(default=None, ge=0, le=100000)
    occurred_at: Optional[datetime] = None


class AnswerEvents(BaseModel):
    tz_offset: int = Field(default=0, ge=-14 * 60, le=14 * 60)
    events: list[AnswerEvent] = Field(..., min_length=1, max_length=5)


def _log_answers(authorization: str, body: AnswerEvents) -> dict:
    from services.learning_events import valid_fingerprint, write_batch
    user_id, db = _student(authorization)
    events = []
    for event in body.events:
        if not valid_fingerprint(event.fingerprint):
            raise HTTPException(status_code=422, detail="fingerprint must be Learn's fingerprint of the question")
        events.append({**event.model_dump(), "mode": "mcp", "decision_id": None})
    # Written as the student: the database only takes their own answers, as mode "mcp".
    return write_batch(db, user_id, [], events, body.tz_offset)


@router.post("/learning-events")
@limiter.limit("60/minute")
async def log_answers(body: AnswerEvents, request: Request, authorization: str = Header(default="")):
    """Answers given in a connected app, logged like the app's (when the learning log is on)."""
    return await run_in_threadpool(_log_answers, authorization, body)


# How the app shows each saved quiz question and flashcard (services/text_processing.shown_questions
# and shown_cards): the connected app reads them itself, as saved, and asks here which to reword and
# which are about the source and never asked. The work is bounded per request: at most 100 study sets,
# 2,000 texts and 200,000 characters in all, and a text of at most 2,001 characters (a longer question
# is sent as its first and last 1,000, where its openings are; web/lib/mcp/wording.mjs). The worst
# request allowed takes well under 200 ms of CPU (tests/test_question_quality_final.py); the app splits
# a bigger read into several requests. Limited per connection (its token), not per address.
WORDING_MAX_SETS = 100
WORDING_MAX_TEXTS = 2_000
WORDING_MAX_CHARS = 200_000
WORDING_TEXT_CHARS = 2_001
WordingText = Annotated[str, Field(max_length=WORDING_TEXT_CHARS)]


# `answered`: whether the saved question has an answer (a quiz is never left with nothing to ask).
class WordingQuestion(BaseModel):
    question: WordingText
    answered: bool = True


class WordingRequest(BaseModel):
    quizzes: list[list[WordingQuestion]] = Field(..., max_length=WORDING_MAX_SETS)
    # Per study set, in the same order: the flashcard fronts its quiz doesn't hold.
    cards: list[list[WordingText]] = Field(default_factory=list, max_length=WORDING_MAX_SETS)

    @model_validator(mode="after")
    def bounded(self):
        texts = [item.question for quiz in self.quizzes for item in quiz] + [front for fronts in self.cards for front in fronts]
        if len(texts) > WORDING_MAX_TEXTS:
            raise ValueError(f"at most {WORDING_MAX_TEXTS} questions and cards per request")
        if sum(len(text) for text in texts) > WORDING_MAX_CHARS:
            raise ValueError(f"at most {WORDING_MAX_CHARS} characters per request")
        return self


def _wording_marks(items: list) -> list:
    return [{key: item[key] for key in ("shown", "hidden") if key in item} for item in items]


def _question_wording(authorization: str, body: WordingRequest) -> dict:
    _student(authorization)
    return question_wording_marks(body)


def question_wording_marks(body: WordingRequest) -> dict:
    """The marks for a request already let through (no database, no AI): the only work the route does."""
    from services.text_processing import shown_questions
    quizzes = [_wording_marks(shown_questions([{"question": item.question, "options": ["answer" if item.answered else ""], "correct_index": 0}
                                               for item in quiz])) for quiz in body.quizzes]
    # A set's cards are sent only in part (those its quiz doesn't hold), so each is marked on its own,
    # as shown_cards marks one: the deck-wide rule (none hidden when all would be) is applied by the
    # app over the whole deck (web/lib/mcp/wording.mjs).
    cards = [[_card_mark(front) for front in fronts] for fronts in body.cards]
    return {"quizzes": quizzes, "cards": cards}


def _card_mark(front: str) -> dict:
    from services.text_processing import standalone_question
    asked = standalone_question(front)
    return {"hidden": True} if asked is None else ({"shown": asked} if asked != front else {})


@router.post("/question-wording", dependencies=[Depends(ai_rate_limit(max_calls=60, window_seconds=60))])
async def question_wording(body: WordingRequest, request: Request, authorization: str = Header(default="")):
    """For each study set's saved quiz, in order: {"shown": wording} for a question asked in other
    words, {"hidden": true} for one about the source that is never asked, {} for one asked as saved;
    and the same for each flashcard front sent in `cards`."""
    return await run_in_threadpool(_question_wording, authorization, body)
