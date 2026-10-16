"""
Text processing utilities for content extraction and cleaning.
Handles LMS content, slideshows, and general educational material.
"""

import re
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

# STRICT nav patterns: unambiguously UI/navigation — never educational content.
# Filtered if line is shorter than pattern + 30 chars.
STRICT_NAV_PATTERNS = {
    # Canvas LMS nav-only
    "dashboard", "inbox", "account", "calendar",
    "collaborations", "conferences", "settings",
    # Blackboard nav
    "course content", "course tools", "my grades", "discussion board",
    "course menu",
    # Moodle nav
    "site home", "site pages", "my courses", "participants", "badges",
    "competencies",
    # Wikipedia chrome
    "main page", "current events", "random article", "about wikipedia",
    "contact us", "donate", "contribute", "community portal", "recent changes",
    "upload file", "what links here", "related changes", "special pages",
    "permanent link", "page information", "cite this page", "wikidata item",
    "download as pdf", "printable version", "in other projects", "wikimedia commons",
    "move to sidebar", "from wikipedia", "free encyclopedia",
    "jump to navigation", "jump to search", "main menu", "personal tools",
    "namespaces", "variants", "search wikipedia",
    # Unambiguous UI elements
    "breadcrumb", "footer", "header", "sidebar",
    "click here", "read more", "learn more", "view all",
    "links to an external site",
    "share this", "bookmark", "follow us", "social media",
    "skip to content", "accessibility", "privacy policy", "terms of use",
    "copyright", "all rights reserved", "cookie",
    "sign out", "log out", "sign in", "log in", "register",
    "create account", "forgot password",
    "newsletter", "unsubscribe", "about us",
    # Video/media player controls
    "panopto", "kaltura", "full screen", "captions",
    # Virtual meeting
    "meeting id", "passcode", "join meeting", "webex",
}

# CONTEXTUAL nav patterns: these words appear in both nav links AND educational
# content. Only filtered if the line is essentially just the word itself
# (a standalone nav link), i.e. shorter than pattern + 5 chars.
CONTEXTUAL_NAV_PATTERNS = {
    "modules", "home", "announcements", "assignments", "discussions",
    "people", "quizzes", "grades", "files", "pages", "syllabus",
    "outcomes", "rubrics", "groups", "tools", "reports", "courses",
    "help", "history",
    "contents", "languages", "edit source", "view history",
    "talk", "article", "read", "views", "toggle", "hide", "show",
    "more", "previous", "next", "submit", "save", "cancel",
    "close", "menu", "navigation",
    "download", "upload", "print", "expand", "collapse",
    "table of contents",
    "youtube", "vimeo", "play", "pause", "volume", "transcript",
    "zoom", "teams",
    "feedback", "report", "flag", "share", "tweet", "like", "comment",
    "subscribe", "contact us",
}

# Patterns that indicate slideshow/presentation content
SLIDESHOW_INDICATORS = [
    r"---\s*slide\s*\d+\s*---",     # Extension's "--- Slide N ---" markers (primary)
    r"^\[slideshow captured:",       # Extension's header "[Slideshow Captured: N slides]"
    r"page\s*\d+\s*of\s*\d+",       # PDF-like pagination "Page 3 of 10"
    r"^\d+\s*/\s*\d+$",             # "1 / 10" format
    # Removed: "presentation", "powerpoint", ".pptx", "google slides"
    # These cause false positives on pages that merely mention these words
]

# Content section headers that indicate educational content
CONTENT_HEADERS = [
    "learning objectives", "objectives", "goals", "overview", "introduction",
    "summary", "key points", "key concepts", "main ideas", "takeaways",
    "chapter", "section", "module", "unit", "lesson", "topic",
    "definition", "example", "practice", "exercise", "activity",
    "important", "note", "remember", "tip", "warning", "caution"
]


def is_navigation_text(text: str) -> bool:
    """Check if text is likely navigation/UI element rather than educational content."""
    text_lower = text.lower().strip()

    # Too short to be meaningful content
    if len(text_lower) < 3:
        return True

    # STRICT patterns: filter if line is short-ish (pattern + 30 chars of context)
    for pattern in STRICT_NAV_PATTERNS:
        if pattern in text_lower:
            if len(text_lower) > len(pattern) + 30:
                continue  # Long enough to be real content containing this word
            return True

    # CONTEXTUAL patterns: only filter if line is essentially just the nav word
    # (a standalone link/button), not a sentence containing the word
    for pattern in CONTEXTUAL_NAV_PATTERNS:
        if pattern in text_lower:
            if len(text_lower) > len(pattern) + 5:
                continue  # Has substantial content beyond the pattern word
            return True

    # Non-content patterns
    if re.match(r'^[\d\s\-\./]+$', text_lower):  # Just numbers/dates
        return True
    if re.match(r'^(mon|tue|wed|thu|fri|sat|sun)', text_lower) and len(text_lower) < 20:
        return True
    if text_lower.startswith('http') or text_lower.startswith('www'):  # URLs
        return True

    return False


def is_slideshow_content(text: str) -> Tuple[bool, str]:
    """
    Detect if content appears to be from a slideshow/presentation.
    Returns (is_slideshow, detected_type).
    Only triggers on explicit slideshow indicators (regex patterns) such as
    '--- Slide N ---' markers from the extension. The old short-lines heuristic
    was removed because it caused false positives on LMS pages with bullet points.
    """
    text_lower = text.lower()

    for pattern in SLIDESHOW_INDICATORS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return True, "slideshow"

    return False, ""


def extract_slideshow_content(text: str) -> List[dict]:
    """
    Extract content from slideshow-formatted text.
    Returns list of slides with title and content.
    Handles the extension's "--- Slide N ---" format as well as plain "Slide N".
    """
    slides = []
    current_slide = {"title": "", "content": []}

    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Stop at the extra page content block appended by the extension
        # to avoid processing duplicated content
        if re.match(r'^-+\s*additional\s*page\s*content\s*-*', line, re.IGNORECASE):
            break

        # Detect slide boundaries — matches both "--- Slide N ---" (extension format)
        # and plain "Slide N" (other sources)
        if re.match(r'^-*\s*slide\s*\d+\s*-*\s*$', line, re.IGNORECASE):
            if current_slide["content"]:
                slides.append(current_slide)
            current_slide = {"title": "", "content": []}
            continue

        # First non-empty line after slide marker is title
        if not current_slide["title"] and len(line) < 100:
            current_slide["title"] = line
        else:
            if not is_navigation_text(line):
                current_slide["content"].append(line)

    # Don't forget last slide
    if current_slide["content"]:
        slides.append(current_slide)

    return slides


def clean_text(text: str) -> str:
    """
    Clean and filter text content, removing navigation and UI elements.
    Preserves educational content structure.
    Includes a safety net: if filtering removes >85% of lines, falls back
    to minimal cleaning to avoid discarding real content.
    """
    if not text:
        return ""

    # Strip non-educational sections (References, See also, etc.)
    # These are section-level blocks, not individual nav lines
    NON_EDUCATIONAL_SECTIONS = {
        "see also", "references", "further reading", "external links",
        "bibliography", "citations", "notes and references", "footnotes",
        "notable people", "notable figures", "key figures", "noted scholars",
    }
    EDUCATIONAL_SECTIONS = {
        "overview", "introduction", "history", "background", "definition",
        "description", "characteristics", "types", "classification",
        "structure", "function", "process", "method", "example",
        "summary", "key points", "conclusion",
    }

    lines = text.splitlines()
    non_empty_lines = [line.strip() for line in lines if line.strip()]

    if not non_empty_lines:
        return ""

    # First pass: remove non-educational sections
    filtered_lines = []
    skipping = False
    for line in non_empty_lines:
        line_lower = line.lower().strip().rstrip('[]')
        # Check if this line is a non-educational section header
        if line_lower in NON_EDUCATIONAL_SECTIONS or any(
            line_lower.startswith(s) for s in NON_EDUCATIONAL_SECTIONS
        ):
            skipping = True
            continue
        # Check if we've hit an educational section header (resume capturing)
        if skipping and (
            line_lower in EDUCATIONAL_SECTIONS or
            any(line_lower.startswith(s) for s in EDUCATIONAL_SECTIONS)
        ):
            skipping = False
        if not skipping:
            filtered_lines.append(line)

    # Use filtered lines if we didn't remove too much
    if len(filtered_lines) >= len(non_empty_lines) * 0.15:
        non_empty_lines = filtered_lines

    cleaned_lines = []

    for line in non_empty_lines:
        # Skip navigation elements
        if is_navigation_text(line):
            continue

        # Skip very short lines unless they're headers
        if len(line) < 5 and not line.endswith(':'):
            continue

        # Skip lines that are just punctuation or special characters
        if re.match(r'^[\W\d]+$', line):
            continue

        cleaned_lines.append(line)

    # SAFETY NET: if we removed >85% of content, the filter was too aggressive.
    # Fall back to minimal cleaning (only strip URLs and truly empty/junk lines).
    if len(cleaned_lines) < len(non_empty_lines) * 0.15:
        logger.warning(
            f"Aggressive filter removed {len(non_empty_lines) - len(cleaned_lines)}"
            f"/{len(non_empty_lines)} lines — falling back to minimal cleaning"
        )
        cleaned_lines = []
        for line in non_empty_lines:
            line_l = line.lower()
            if line_l.startswith('http') or line_l.startswith('www'):
                continue
            if len(line) < 3:
                continue
            if re.match(r'^[\W\d]+$', line):
                continue
            cleaned_lines.append(line)

    return '\n'.join(cleaned_lines)


# text_processing.py (replace chunk_text with this)
def chunk_text(text: str, max_length: int = 1500, slides: List[dict] = None) -> List[str]:
    """
    Split text into chunks for processing, respecting slide boundaries when slides are provided.
    If `slides` is given (list of {'title','content'}), prefer returning one chunk per slide.
    Otherwise, fall back to paragraph/sentence chunking.
    """
    if slides:
        chunks = []
        for i, slide in enumerate(slides, 1):
            title = slide.get('title', '').strip() or f'Untitled Slide {i}'
            content = slide.get('content', [])
            content_text = '\n'.join(content) if isinstance(content, list) else content
            if not content_text.strip():
                continue
            chunk = (
                f"<SLIDE>\n<NUMBER>{i}</NUMBER>\n<TITLE>{title}</TITLE>\n"
                f"<CONTENT>\n{content_text.strip()}\n</CONTENT>\n</SLIDE>"
            )
            chunks.append(chunk)
        return chunks

    # fallback behavior for plain text (existing logic, simplified)
    if not text:
        return []

    paragraphs = re.split(r'\n\s*\n', text)
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 2 <= max_length:
            current_chunk += ("\n\n" if current_chunk else "") + para
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            if len(para) > max_length:
                sentences = re.split(r'(?<=[.!?])\s+', para)
                current_chunk = ""
                for sentence in sentences:
                    if len(current_chunk) + len(sentence) + 1 <= max_length:
                        current_chunk += (" " if current_chunk else "") + sentence
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        current_chunk = sentence
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


def build_review_sections(text: str, max_length: int = 6000) -> List[dict]:
    """Create reviewable source sections without asking a model to copy the source."""
    sections = []
    for index, chunk in enumerate(chunk_text(clean_text(text), max_length=max_length), 1):
        first_line = next((line.strip() for line in chunk.splitlines() if line.strip()), "")
        heading = first_line if 3 <= len(first_line) <= 100 else f"Study material {index}"
        sections.append({"id": f"section-{index}", "heading": heading, "text": chunk})
    return sections


def format_slideshow_text(slides: List[dict]) -> str:
    """
    Format extracted slides into XML-structured text.
    Uses XML tags for clear slide boundaries that LLMs parse reliably.
    Preserves all slide content so nothing is lost to compression.
    """
    parts = []
    for i, slide in enumerate(slides, 1):
        title = slide.get('title', '') or f'Untitled Slide {i}'
        content = slide.get('content', [])
        content_text = '\n'.join(content) if isinstance(content, list) else content
        parts.append(
            f"<SLIDE>\n<NUMBER>{i}</NUMBER>\n<TITLE>{title}</TITLE>\n"
            f"<CONTENT>\n{content_text.strip()}\n</CONTENT>\n</SLIDE>"
        )
    return '\n\n'.join(parts)


def extract_key_terms(text: str) -> List[str]:
    """
    Extract potential key terms and concepts from text.
    Looks for capitalized phrases, bold/emphasized text, and defined terms.
    """
    terms = set()

    # Capitalized phrases (potential proper nouns/key terms)
    caps_pattern = r'\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)\b'
    for match in re.finditer(caps_pattern, text):
        term = match.group(1)
        # Filter out common words and too short terms
        if len(term) > 3 and term.lower() not in {'the', 'this', 'that', 'these', 'those'}:
            terms.add(term)

    # Terms in quotes or parentheses (often definitions)
    quoted_pattern = r'["\']([^"\']+)["\']|\(([^)]+)\)'
    for match in re.finditer(quoted_pattern, text):
        term = match.group(1) or match.group(2)
        if term and 3 < len(term) < 50:
            terms.add(term.strip())

    # Terms followed by "is defined as", "means", "refers to"
    definition_pattern = r'(\b[A-Za-z][\w\s]+?)\s+(?:is defined as|means|refers to|is called)'
    for match in re.finditer(definition_pattern, text, re.IGNORECASE):
        term = match.group(1).strip()
        if 3 < len(term) < 50:
            terms.add(term)

    return list(terms)


def inject_image_descriptions(slides: list, image_descriptions: dict) -> list:
    """
    Merge image analysis results into slide content.

    Args:
        slides: list of dicts from extract_slideshow_content(), each with
                'title' (str) and 'content' (list of str)
        image_descriptions: {slide_index (int): description_text (str)}

    Returns:
        slides list with image descriptions appended to the matching slide's content
    """
    if not image_descriptions:
        return slides

    for slide_idx, description in image_descriptions.items():
        if not description or not description.strip():
            continue
        # slide_index 0 → slides[0], etc.
        if isinstance(slide_idx, int) and 0 <= slide_idx < len(slides):
            slides[slide_idx]["content"].append(f"[Visual Content]: {description.strip()}")

    return slides


def inject_page_image_descriptions(text: str, image_descriptions: dict) -> str:
    """
    Append image analysis results to cleaned page text (non-slideshow).

    Args:
        text: cleaned page text
        image_descriptions: {index: description_text}

    Returns:
        text with image descriptions appended
    """
    if not image_descriptions:
        return text

    additions = []
    for idx, description in image_descriptions.items():
        if description and description.strip():
            additions.append(f"[Visual Content]: {description.strip()}")

    if additions:
        text += "\n\n" + "\n\n".join(additions)

    return text


# ── Lecture transcripts ──────────────────────────────────────────────────────
# Recording uploads 20-second chunks that overlap by about 2 seconds, so each chunk's
# opening words usually repeat the end of the previous one. These helpers run before any
# AI step: the overlap is removed here, not by asking a model to ignore it.

_WORD = re.compile(r"[\w'’]+", re.UNICODE)
_FILLERS = re.compile(r",?\s*\b(?:um+|uh+|erm+|hmm+|mm+|uh-huh)\b[,.]?(?=\s|$)", re.IGNORECASE)


def _norm_words(text: str) -> List[str]:
    return [w.lower().replace("’", "'") for w in _WORD.findall(text or "")]


def merge_overlap(previous_tail: str, new_text: str, max_words: int = 30) -> str:
    """Drop the opening words of `new_text` that repeat the end of `previous_tail`.

    Finds the longest run (at least 2 words, at most `max_words`) where the last words of
    the previous transcript equal the first words of the new chunk, then cuts it from the
    new chunk while keeping its original spelling and punctuation."""
    new_text = (new_text or "").strip()
    tail = _norm_words(previous_tail)[-max_words:]
    head = _norm_words(new_text)[:max_words]
    best = 0
    for size in range(min(len(tail), len(head)), 1, -1):
        if tail[-size:] == head[:size]:
            best = size
            break
    if not best:
        return new_text
    matches = list(_WORD.finditer(new_text))
    cut = matches[best - 1].end()
    return new_text[cut:].lstrip(" ,.;:-–—").strip()


def clean_spoken_text(text: str) -> str:
    """Remove spoken fillers and doubled spaces; keeps every substantive word."""
    text = _FILLERS.sub(" ", text or "")
    text = re.sub(r"\b(\w+)( \1\b)+", r"\1", text, flags=re.IGNORECASE)  # "the the" -> "the"
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def transcript_text(segments: list) -> str:
    """Join timed transcript segments ({start_ms, text}) into one cleaned text, in order."""
    ordered = sorted((s for s in segments or [] if (s.get("text") or "").strip()), key=lambda s: int(s.get("start_ms") or 0))
    return clean_spoken_text(" ".join(s["text"].strip() for s in ordered))
