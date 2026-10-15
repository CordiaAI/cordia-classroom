"""Per-student instructions added to AI prompts.

Both are optional extras: when they cannot be loaded the AI still answers, so a
failure is logged and an empty instruction is returned.
"""
import logging

from database import get_supabase
from routers.stats import learning_profile_for_user
from services.learning_styles import active_style, explanation_instruction, load_preference, tutor_style_instruction

logger = logging.getLogger(__name__)


def learning_guidance(user_id: str) -> str:
    """Question style tuned to how the student has been doing in practice."""
    try:
        return learning_profile_for_user(user_id)["generation_guidance"]
    except Exception:
        logger.warning("Learning guidance unavailable for user %s", user_id[:8], exc_info=True)
        return ""


def style_instruction(user_id: str) -> str:
    """Tutor presentation: the chosen study style and the student's own explanation request."""
    try:
        supabase = get_supabase()
        return "\n".join(filter(None, [
            tutor_style_instruction(active_style(supabase, user_id)),
            explanation_instruction(load_preference(supabase, user_id).get("explain_preference")),
        ]))
    except Exception:
        logger.warning("Tutor style unavailable for user %s", user_id[:8], exc_info=True)
        return ""
