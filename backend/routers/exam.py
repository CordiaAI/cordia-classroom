"""
Generalized exam router for CordiaClassroom.
Generates domain-specific practice exam questions (NCLEX, Bar, technical, etc.)
from study guide content using few-shot examples from domain config files.
"""

import re
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import List
from database import get_supabase
from services.llm import generate_exam_questions
from auth_utils import get_user_id
from services.entitlements import record, require

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exam", tags=["exam"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


class ExamAnswer(BaseModel):
    question_index: int = Field(..., ge=0, le=500)
    selected_indices: List[int] = Field(..., max_length=10)
    is_correct: bool = False


class ExamSubmission(BaseModel):
    domain: str = Field(..., max_length=30)
    mode: str = Field(..., max_length=30)
    answers: List[ExamAnswer] = Field(..., max_length=200)


@router.get("/{guide_id}/generate")
def generate_exam(
    guide_id: str,
    domain: str,
    mode: str,
    authorization: str = Header(default="")
):
    """Generate domain-specific exam questions from a saved study guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)

        # Validate domain and mode exist
        from domains import get_domain
        domain_config = get_domain(domain)
        if not domain_config:
            raise HTTPException(status_code=400, detail=f"Unknown domain: {domain}")

        valid_modes = [m['id'] for m in domain_config.get('exam_modes', [])]
        if mode not in valid_modes:
            raise HTTPException(status_code=400, detail=f"Unknown exam mode '{mode}' for domain '{domain}'")

        supabase = get_supabase()
        result = supabase.table("study_guides") \
            .select("notes, study_guide") \
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

        combined = "\n\n".join(filter(None, [notes, study_guide]))

        require(user_id, "exam")
        questions = generate_exam_questions(combined, domain, mode)

        if not questions:
            raise HTTPException(status_code=500, detail="Failed to generate exam questions. Please try again.")

        record(user_id, "exam")
        return {"questions": questions}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating {domain}/{mode} exam questions: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate exam questions")


@router.post("/{guide_id}/submit")
def submit_exam(guide_id: str, submission: ExamSubmission, authorization: str = Header(default="")):
    """Submit exam answers and save results."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        total = len(submission.answers)
        if total == 0:
            raise HTTPException(status_code=400, detail="No answers submitted")

        correct = sum(1 for a in submission.answers if a.is_correct)
        score = round((correct / total) * 100)

        session_type = f"{submission.domain}_{submission.mode}"

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
            "session_type": session_type,
            "duration_seconds": 0,
            "metadata": {"score": score, "total": total, "correct": correct, "domain": submission.domain, "mode": submission.mode}
        }).execute()

        from routers.stats import _update_streak
        _update_streak(user_id)

        return {"score": score, "total": total, "correct": correct}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit exam results")
