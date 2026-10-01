"""
Single source of truth for which OpenAI model each task uses and how much it may write.

Swap a model without a deploy by changing an env var (Fly: `fly secrets set ...` restarts the
app; no code change). Nothing outside this file should contain a model name literal.

Roles
  BUILD   Study guides, practice sets, exam/NCLEX/practice questions, flashcards, notes.
          Anything that must be exhaustive and accurate. Never chosen by input size.
  LIGHT   Tutor Q&A, grading, classification, distractors, diagrams, study aids.
  VISION  Handwriting, page transcription, slide/image analysis, image extraction.

Env vars (all optional)
  CLASSROOM_BUILD_MODEL   default gpt-4o
  CLASSROOM_LIGHT_MODEL   default gpt-4o-mini
  CLASSROOM_VISION_MODEL  default gpt-4o
  STUDY_GUIDE_COST_SAVER  default false. When "true", text-only study-guide batches shorter than
                          STUDY_GUIDE_COST_SAVER_MAX_CHARS (default 10000) use LIGHT_MODEL.
                          Long/dense batches and any batch with images always keep BUILD_MODEL.
"""

import os
from contextvars import ContextVar
from typing import NamedTuple, Optional

BUILD = "build"
LIGHT = "light"
VISION = "vision"

BUILD_MODEL = os.getenv("CLASSROOM_BUILD_MODEL", "gpt-4o").strip() or "gpt-4o"
LIGHT_MODEL = os.getenv("CLASSROOM_LIGHT_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
VISION_MODEL = os.getenv("CLASSROOM_VISION_MODEL", "gpt-4o").strip() or "gpt-4o"

ROLE_MODELS = {BUILD: BUILD_MODEL, LIGHT: LIGHT_MODEL, VISION: VISION_MODEL}

STUDY_GUIDE_COST_SAVER = os.getenv("STUDY_GUIDE_COST_SAVER", "false").strip().lower() == "true"
try:
    STUDY_GUIDE_COST_SAVER_MAX_CHARS = int(os.getenv("STUDY_GUIDE_COST_SAVER_MAX_CHARS", "10000"))
except ValueError:
    STUDY_GUIDE_COST_SAVER_MAX_CHARS = 10000


class CallSpec(NamedTuple):
    role: str
    max_tokens: int


# feature name -> (role, max_tokens). The feature name is also what usage_events records.
FEATURES = {
    # BUILD
    "study_guide": CallSpec(BUILD, 12000),
    "smart_notes_guide": CallSpec(BUILD, 8000),
    "nclex_questions": CallSpec(BUILD, 16000),
    "practice_questions": CallSpec(BUILD, 16000),
    "exam_questions": CallSpec(BUILD, 16000),
    "practice_set": CallSpec(BUILD, 9000),
    "flashcards": CallSpec(BUILD, 2048),
    "notes": CallSpec(BUILD, 2000),
    "slideshow_summary": CallSpec(BUILD, 1500),
    "retain_explain": CallSpec(BUILD, 500),
    # LIGHT
    "tutor_clarify": CallSpec(LIGHT, 500),
    "tutor_rich": CallSpec(LIGHT, 1400),
    "tutor_example": CallSpec(LIGHT, 300),
    "tutor_detailed": CallSpec(LIGHT, 700),
    "tutor_short": CallSpec(LIGHT, 200),
    "practice_grade": CallSpec(LIGHT, 300),
    "practice_classify": CallSpec(LIGHT, 100),
    "quiz_distractors": CallSpec(LIGHT, 4096),
    "smart_notes_diagram": CallSpec(LIGHT, 2000),
    "study_aid": CallSpec(LIGHT, 700),
    "study_aid_check": CallSpec(LIGHT, 250),
    # VISION
    "page_transcription": CallSpec(VISION, 1800),
    "handwriting": CallSpec(VISION, 800),
    "slide_vision": CallSpec(VISION, 500),
    "image_extraction": CallSpec(VISION, 2000),
}


def model_for(feature: str) -> str:
    return ROLE_MODELS[FEATURES[feature].role]


def study_guide_model(batch_chars: int, has_images: bool) -> str:
    """Study guides use BUILD_MODEL regardless of length; the opt-in cost saver only downgrades short text."""
    if STUDY_GUIDE_COST_SAVER and not has_images and batch_chars < STUDY_GUIDE_COST_SAVER_MAX_CHARS:
        return LIGHT_MODEL
    return BUILD_MODEL


# Set by auth_utils.get_user_id so usage rows carry the caller without threading user_id through every function.
current_user_id: ContextVar[Optional[str]] = ContextVar("current_user_id", default=None)
