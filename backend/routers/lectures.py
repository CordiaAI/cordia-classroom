"""Lecture recording: chunked transcription, rolling notes and the final clean-up pass.

The browser records 20-second chunks (about 2 seconds of overlap) and uploads each one
right away. Audio is transcribed and dropped: nothing is stored unless the student turns
on "Keep audio" (that path needs the lecture-audio bucket from the pending migration).
The OpenAI key stays on the server (OPENAI_API_KEY).

Usage is metered in minutes (feature "lecture_minute"): each minute of audio is charged
once per recording, so retries and overlap are never charged twice.
"""

import io
import json
import logging
import math
import re
from typing import List, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from services import entitlements
from services.llm import get_openai_client
from services.llm_calls import chat
from services.models import TRANSCRIBE_MODEL
from services.text_processing import clean_spoken_text, extract_key_terms, merge_overlap, transcript_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/lectures", tags=["lectures"])

FEATURE = "lecture_minute"
MAX_CHUNK_BYTES = 6 * 1024 * 1024          # a 20 s chunk is far smaller; this only stops abuse
MAX_FILE_BYTES = 25 * 1024 * 1024          # the transcription API's own upload limit
AUDIO_TYPES = {
    "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
    "audio/m4a": "m4a", "audio/aac": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/wave": "wav",
}
_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
FAILED = "Couldn't transcribe this part. It will be retried."


def _recording_id(value: str) -> str:
    if not value or not _ID.match(value):
        raise HTTPException(status_code=400, detail="Invalid recording")
    return value


def _extension(upload: UploadFile) -> str:
    kind = (upload.content_type or "").split(";")[0].strip().lower()
    if kind in AUDIO_TYPES:
        return AUDIO_TYPES[kind]
    name = (upload.filename or "").lower()
    for ext in ("webm", "ogg", "m4a", "mp4", "mp3", "wav"):
        if name.endswith("." + ext):
            return "m4a" if ext == "mp4" else ext
    raise HTTPException(status_code=415, detail="Use an mp3, m4a, wav or webm recording.")


def _prompt(previous_tail: str, terms: str) -> str:
    """Short context for the speech model: the class's key terms and the last ~200 characters."""
    terms = ", ".join(t.strip() for t in (terms or "").split(",") if t.strip())[:400]
    tail = (previous_tail or "")[-200:]
    return "\n".join(part for part in (f"Terms: {terms}" if terms else "", tail) if part)


def _transcribe(data: bytes, ext: str, prompt: str) -> str:
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=503, detail="Transcription isn't available right now.")
    audio = io.BytesIO(data)
    audio.name = f"chunk.{ext}"
    result = client.audio.transcriptions.create(model=TRANSCRIBE_MODEL, file=audio, prompt=prompt or None, response_format="json")
    return (getattr(result, "text", "") or "").strip()


def _charge_minutes(user_id: str, recording_id: str, start_ms: int, duration_ms: int) -> None:
    """Charge each whole minute this audio touches, once per recording (request keys dedupe)."""
    first = max(0, start_ms) // 60000
    last = max(first, (max(0, start_ms) + max(0, duration_ms) - 1) // 60000)
    for minute in range(first, last + 1):
        try:
            entitlements.record(user_id, FEATURE, request_key=f"{recording_id}:{minute}")
        except Exception as error:  # the usage feature needs the pending migration
            logger.warning("lecture minute not recorded: %s", type(error).__name__)
            return


@router.get("/usage")
def usage(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    try:
        left = entitlements.remaining(user_id, FEATURE)
    except Exception:
        left = entitlements.LIMITS["free"][FEATURE]
    plan = entitlements.plan_for(entitlements.subscription_row(user_id))
    return {"minutes_left": left, "minutes_limit": entitlements.LIMITS[plan][FEATURE]}


@router.post("/chunk")
async def chunk(
    authorization: str = Header(default=""),
    audio: UploadFile = File(...),
    recording_id: str = Form(...),
    seq: int = Form(...),
    start_ms: int = Form(...),
    duration_ms: int = Form(...),
    previous_tail: str = Form(""),
    terms: str = Form(""),
):
    """Transcribe one chunk and return only the words that are new (overlap removed)."""
    user_id = get_user_id(authorization)
    recording_id = _recording_id(recording_id)
    entitlements.require(user_id, FEATURE)
    data = await audio.read(MAX_CHUNK_BYTES + 1)
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail="This part of the recording is too large.")
    if not data:
        return {"seq": seq, "start_ms": start_ms, "text": ""}
    ext = _extension(audio)
    try:
        raw = _transcribe(data, ext, _prompt(previous_tail, terms))
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("chunk transcription failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail=FAILED)
    text = clean_spoken_text(merge_overlap(previous_tail, raw))
    _charge_minutes(user_id, recording_id, start_ms, duration_ms)
    return {"seq": seq, "start_ms": start_ms, "text": text}


class Segment(BaseModel):
    start_ms: int = Field(ge=0)
    text: str = Field(default="", max_length=20000)


class ClassOption(BaseModel):
    id: str = Field(max_length=64)
    name: str = Field(max_length=200)


class NotesRequest(BaseModel):
    segments: List[Segment] = Field(default_factory=list, max_length=2000)
    classes: List[ClassOption] = Field(default_factory=list, max_length=200)


NOTES_RULES = """You turn a lecture transcript into short running notes. Use only what the speaker said.
Return JSON: {"notes": [{"kind": "heading"|"definition"|"term"|"exam", "text": "...", "at_ms": <start_ms of the segment it came from>}], "class_id": "<id or empty>"}
- heading: the speaker moves to a new topic (a few words).
- definition: the speaker explains what something is or means ("X is ...").
- term: a key term, name, date, formula or idea the speaker stresses.
- exam: anything the speaker flags as important for a test, assignment or grade.
- Every item must be supported by the transcript. Do not add outside knowledge.
- class_id: the id of the class whose name best matches the lecture's subject, or "" if none fits."""


@router.post("/notes")
def notes(request: NotesRequest, authorization: str = Header(default="")):
    """Rolling notes for the recording screen (called about every 3 minutes)."""
    get_user_id(authorization)
    lines = [f"[{s.start_ms}] {clean_spoken_text(s.text)}" for s in sorted(request.segments, key=lambda s: s.start_ms) if s.text.strip()]
    if not lines:
        return {"notes": [], "class_id": ""}
    client = get_openai_client()
    if not client:
        return {"notes": [], "class_id": ""}
    classes = "\n".join(f"{c.id}: {c.name}" for c in request.classes) or "(none)"
    try:
        response = chat(client, "lecture_notes", response_format={"type": "json_object"}, messages=[
            {"role": "system", "content": NOTES_RULES},
            {"role": "user", "content": f"Classes:\n{classes}\n\nTranscript (each line starts with [start_ms]):\n" + "\n".join(lines)[-24000:]},
        ])
        parsed = json.loads(response.choices[0].message.content or "{}")
    except Exception as error:
        logger.warning("lecture notes failed: %s", type(error).__name__)
        return {"notes": [], "class_id": ""}
    valid_ids = {c.id for c in request.classes}
    starts = sorted(s.start_ms for s in request.segments)
    items = []
    for item in parsed.get("notes") or []:
        kind = item.get("kind")
        text = str(item.get("text") or "").strip()[:300]
        if kind not in ("heading", "definition", "term", "exam") or not text:
            continue
        at = int(item.get("at_ms") or 0)
        at = max((s for s in starts if s <= at), default=starts[0] if starts else 0)  # snap to a real segment
        items.append({"kind": kind, "text": text, "at_ms": at})
    class_id = parsed.get("class_id") if parsed.get("class_id") in valid_ids else ""
    return {"notes": items[:80], "class_id": class_id}


class FinishRequest(BaseModel):
    segments: List[Segment] = Field(default_factory=list, max_length=4000)


CLEANUP_RULES = """Clean this lecture transcript for reading. Keep every substantive sentence and all
facts, names, numbers and examples exactly as spoken. Fix punctuation, capitalization and obvious
speech-recognition slips, remove false starts and repeated phrases, and break it into paragraphs.
Do not summarize, add, or reorder content. Return only the cleaned text."""

TITLE_RULES = """Give this lecture a short, specific title (3 to 8 words) naming its subject, as a
student would label their notes. No quotes, no date, no trailing punctuation. Return only the title."""


def _cleanup(client, text: str) -> str:
    # Clean in ~9,000-character pieces split on sentence ends, so long lectures stay complete.
    pieces, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if len(current) + len(sentence) > 9000 and current:
            pieces.append(current)
            current = ""
        current += (" " if current else "") + sentence
    if current:
        pieces.append(current)
    cleaned = []
    for piece in pieces:
        try:
            response = chat(client, "lecture_cleanup", messages=[
                {"role": "system", "content": CLEANUP_RULES}, {"role": "user", "content": piece},
            ])
            out = (response.choices[0].message.content or "").strip()
            # Never let the clean-up shrink the lecture: fall back to the original piece.
            cleaned.append(out if len(out) >= 0.7 * len(piece) else piece)
        except Exception as error:
            logger.warning("lecture cleanup failed: %s", type(error).__name__)
            cleaned.append(piece)
    return "\n\n".join(cleaned)


@router.post("/finish")
def finish(request: FinishRequest, authorization: str = Header(default="")):
    """Clean the full transcript and title it; the browser then builds the guide like any upload."""
    get_user_id(authorization)
    text = transcript_text([s.model_dump() for s in request.segments])
    if len(text) < 40:
        raise HTTPException(status_code=422, detail="The recording is too short to make a guide.")
    client = get_openai_client()
    if not client:
        return {"title": "", "transcript": text}
    transcript = _cleanup(client, text)
    title = ""
    try:
        response = chat(client, "lecture_notes", max_tokens=30, messages=[
            {"role": "system", "content": TITLE_RULES}, {"role": "user", "content": transcript[:6000]},
        ])
        title = re.sub(r"[\"'.]+$", "", (response.choices[0].message.content or "").strip().strip('"'))[:120]
    except Exception as error:
        logger.warning("lecture title failed: %s", type(error).__name__)
    return {"title": title, "transcript": transcript}


@router.post("/transcribe-file")
async def transcribe_file(
    authorization: str = Header(default=""),
    audio: UploadFile = File(...),
    recording_id: str = Form(...),
    duration_ms: int = Form(0),
    terms: str = Form(""),
):
    """Upload recording: transcribe a whole mp3, m4a, wav or webm file (up to 25 MB)."""
    user_id = get_user_id(authorization)
    recording_id = _recording_id(recording_id)
    entitlements.require(user_id, FEATURE)
    ext = _extension(audio)
    data = await audio.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Recordings up to 25 MB can be uploaded. Record in Cordia for longer lectures.")
    plan = entitlements.plan_for(entitlements.subscription_row(user_id))
    limit = entitlements.LIMITS[plan][FEATURE]
    left = entitlements.remaining(user_id, FEATURE)
    minutes = math.ceil(max(0, duration_ms) / 60000)
    if minutes and minutes > left:
        raise entitlements.LimitReached(FEATURE, limit - left, limit, plan)
    try:
        text = clean_spoken_text(_transcribe(data, ext, _prompt("", terms)))
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("file transcription failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="Couldn't transcribe this recording. Try again.")
    _charge_minutes(user_id, recording_id, 0, duration_ms or 60000)
    return {"segments": [{"start_ms": 0, "text": text}], "text": text}


@router.get("/terms")
def class_terms(folder_id: Optional[str] = None, authorization: str = Header(default="")):
    """Key terms from the student's guides in a class, sent as transcription context."""
    user_id = get_user_id(authorization)
    if not folder_id:
        return {"terms": []}
    from database import get_supabase
    try:
        rows = get_supabase().table("study_guides").select("title,study_guide").eq("user_id", user_id).eq("folder_id", folder_id).limit(10).execute().data or []
    except Exception:
        return {"terms": []}
    terms: List[str] = []
    for row in rows:
        for term in extract_key_terms(f"{row.get('title') or ''}\n{(row.get('study_guide') or '')[:6000]}"):
            if term not in terms:
                terms.append(term)
    return {"terms": terms[:40]}


AUDIO_BUCKET = "lecture-audio"


@router.post("/audio")
async def keep_audio(
    authorization: str = Header(default=""),
    audio: UploadFile = File(...),
    recording_id: str = Form(...),
    seq: int = Form(...),
):
    """"Keep audio" is on: store this chunk in the private lecture-audio bucket (pending migration)."""
    user_id = get_user_id(authorization)
    recording_id = _recording_id(recording_id)
    ext = _extension(audio)
    data = await audio.read(MAX_CHUNK_BYTES + 1)
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail="This part of the recording is too large.")
    from database import get_supabase
    path = f"{user_id}/{recording_id}/{int(seq):05d}.{ext}"
    try:
        get_supabase().storage.from_(AUDIO_BUCKET).upload(path, data, {"content-type": audio.content_type or "application/octet-stream", "upsert": "true"})
    except Exception as error:
        logger.warning("keep audio failed: %s", type(error).__name__)
        raise HTTPException(status_code=503, detail="Keeping audio isn't available yet.")
    return {"stored": True}
