"""
NCLEX router for CordiaClassroom.
Generates clinical scenario MCQ and SATA questions with rationales from study guide content.
"""

import re
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import List
from database import get_supabase
from services.llm import generate_nclex_questions
from auth_utils import get_user_id
from services.entitlements import record, require

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nclex", tags=["nclex"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


class NCLEXAnswer(BaseModel):
    question_index: int = Field(..., ge=0, le=500)
    selected_indices: List[int] = Field(..., max_length=10)
    is_correct: bool = False


class NCLEXSubmission(BaseModel):
    answers: List[NCLEXAnswer] = Field(..., max_length=200)


@router.get("/{guide_id}/generate")
def generate_nclex(guide_id: str, authorization: str = Header(default="")):
    """Generate NCLEX-style questions from a saved study guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("study_guides") \
            .select("notes, study_guide, nclex_questions") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Guide not found")

        row = result.data[0]
        notes = row.get("notes") or ""
        study_guide = row.get("study_guide") or ""

        if not notes and not study_guide:
            raise HTTPException(status_code=400, detail="No content available. Generate a study guide first.")

        # Combine both fields for maximum topic coverage
        combined = "\n\n".join(filter(None, [notes, study_guide]))

        # Return cached questions if already generated
        cached = row.get("nclex_questions")
        if cached:
            return {"questions": cached, "cached": True}

        require(user_id, "nclex")
        questions = generate_nclex_questions(combined)

        if not questions:
            raise HTTPException(status_code=500, detail="Failed to generate NCLEX questions. Please try again.")

        # Save to study guide so it's never regenerated again
        try:
            supabase.table("study_guides").update(
                {"nclex_questions": questions}
            ).eq("id", guide_id).eq("user_id", user_id).execute()
        except Exception as save_err:
            logger.warning(f"Failed to cache NCLEX questions: {save_err}")

        record(user_id, "nclex")
        return {"questions": questions, "cached": False}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating NCLEX questions: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate NCLEX questions")


@router.post("/{guide_id}/submit")
def submit_nclex(guide_id: str, submission: NCLEXSubmission, authorization: str = Header(default="")):
    """Submit NCLEX quiz answers and save results."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        total = len(submission.answers)
        if total == 0:
            raise HTTPException(status_code=400, detail="No answers submitted")

        correct = sum(1 for a in submission.answers if a.is_correct)
        score = round((correct / total) * 100)

        supabase.table("quiz_attempts").insert({
            "user_id": user_id,
            "guide_id": guide_id,
            "score": score,
            "total_questions": total,
            "correct_answers": correct,
            "answers": [a.model_dump() for a in submission.answers]
        }).execute()

        supabase.table("study_sessions").insert({
            "user_id": user_id,
            "guide_id": guide_id,
            "session_type": "nclex_quiz",
            "duration_seconds": 0,
            "metadata": {"score": score, "total": total, "correct": correct}
        }).execute()

        from routers.stats import _update_streak
        _update_streak(user_id)

        return {"score": score, "total": total, "correct": correct}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting NCLEX quiz: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit NCLEX quiz")
