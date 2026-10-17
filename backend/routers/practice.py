"""Practice sets: ten verified problems from a guide or uploaded text, saved per guide."""
import json
import logging
import re

from fastapi import APIRouter, Header, HTTPException, Request

from auth_utils import get_user_id
from database import get_supabase
from rate_limit import limiter
from schemas import PracticeGradeRequest, PracticeProgressRequest, PracticeRecognizeRequest, PracticeRequest
from services.entitlements import record, require
from services.guidance import learning_guidance
from services.llm import generate_verified_practice_set, grade_practice_answer, recognize_handwriting
from services.text_processing import html_to_text
from services.tutor_sessions import append_tutor_message

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/practice", tags=["practice"])

MAX_CONTENT_LENGTH = 500_000
MAX_PROGRESS_BYTES = 200_000
PROBLEMS_PER_SET = 10
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.IGNORECASE)
INVALID_GUIDE = "That study guide link is not valid."
MISSING_GUIDE = "That study guide is no longer available."


def _owned_guide(guide_id: str, user_id: str, columns: str) -> dict:
    if not UUID.fullmatch(guide_id or ""):
        raise HTTPException(status_code=400, detail=INVALID_GUIDE)
    result = get_supabase().table("study_guides").select(columns) \
        .eq("id", guide_id).eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail=MISSING_GUIDE)
    return result.data[0]


def _save_practice_state(guide_id: str, user_id: str, state: dict) -> None:
    get_supabase().table("study_guides").update({"practice_state": state}) \
        .eq("id", guide_id).eq("user_id", user_id).execute()


@router.post("")
@limiter.limit("10/minute")
def create_practice_set(body: PracticeRequest, request: Request, authorization: str = Header(default="")):
    """Generate ten practice problems from a guide or uploaded text."""
    user_id = get_user_id(authorization)
    if body.guide_id:
        guide = _owned_guide(body.guide_id, user_id, "id,title,study_guide,notes")
        content = "\n\n".join(filter(None, [html_to_text(guide.get("notes") or ""), guide.get("study_guide") or ""]))
        title = guide.get("title") or "Study Guide"
        source = {"type": "study_guide", "id": guide["id"], "title": title}
    else:
        content = body.content or ""
        title = (body.title or "").strip() or "Uploaded study material"
        source = {"type": "upload", "title": title}
    content = content[:MAX_CONTENT_LENGTH]
    if not content.strip():
        raise HTTPException(status_code=400, detail="Add a study guide or upload readable study material first.")

    require(user_id, "practice")
    practice = generate_verified_practice_set(content, learning_guidance(user_id))
    problems = practice.get("problems", []) if isinstance(practice, dict) else []
    if len(problems) != PROBLEMS_PER_SET:
        raise HTTPException(
            status_code=502,
            detail="Cordia could not verify a complete 10-problem set from this material. Please try another source or add more detail.",
        )
    record(user_id, "practice")

    practice_set = {
        "title": f"{title} — Practice",
        "source": source,
        "subject_area": practice.get("subject_area") or "General study",
        "domain": practice.get("domain") or "general",
        "truth_note": practice.get("truth_note"),
        "problems": problems,
    }
    if body.guide_id:
        # A new set replaces the guide's saved set and clears its progress.
        _save_practice_state(source["id"], user_id, {**practice_set, "progress": {}})
    return practice_set


@router.get("/{guide_id}/state")
def get_practice_state(guide_id: str, authorization: str = Header(default="")):
    """The guide's saved practice set and progress, or null when none exists."""
    guide = _owned_guide(guide_id, get_user_id(authorization), "id,practice_state")
    return {"practice": guide.get("practice_state")}


@router.put("/{guide_id}/state")
@limiter.limit("120/minute")
def save_practice_progress(guide_id: str, body: PracticeProgressRequest, request: Request, authorization: str = Header(default="")):
    """Save answers, results, and typed work for the guide's current practice set."""
    user_id = get_user_id(authorization)
    practice = _owned_guide(guide_id, user_id, "id,practice_state").get("practice_state")
    if not practice:
        raise HTTPException(status_code=404, detail="Generate a practice set first.")
    if len(json.dumps(body.progress)) > MAX_PROGRESS_BYTES:
        raise HTTPException(status_code=413, detail="Practice progress is too large to save.")
    _save_practice_state(guide_id, user_id, {**practice, "progress": body.progress})
    return {"saved": True}


@router.post("/grade")
@limiter.limit("60/minute")
def grade_practice(body: PracticeGradeRequest, request: Request, authorization: str = Header(default="")):
    """Mark one answer right or wrong; a wrong answer's explanation goes to the Tutor."""
    user_id = get_user_id(authorization)
    result = grade_practice_answer(body.prompt, body.reference, body.worked_solution, body.student_answer, body.work)
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not check this answer. Please try again.")
    if not result["correct"] and result["explanation"]:
        # The page shows only Right / Not quite; the explanation is optional, so a failure here is logged.
        try:
            append_tutor_message(user_id, result["explanation"])
        except Exception:
            logger.warning("Could not post practice feedback to the Tutor", exc_info=True)
    return result


@router.post("/recognize")
@limiter.limit("20/minute")
def recognize_practice_handwriting(body: PracticeRecognizeRequest, request: Request, authorization: str = Header(default="")):
    """Turn a drawing from the practice workspace into typed text."""
    get_user_id(authorization)
    text = recognize_handwriting(body.image)
    if text is None:
        raise HTTPException(status_code=502, detail="Cordia could not read this drawing. Please try again.")
    return {"text": text}
