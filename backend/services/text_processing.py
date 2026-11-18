"""
Text processing utilities for content extraction and cleaning.
Handles LMS content, slideshows, and general educational material.
"""

import re
import logging
from html.parser import HTMLParser
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
        if re.fullmatch(r'-{0,10}\s{0,5}slide\s{0,5}\d{1,4}\s{0,5}-{0,10}', line, re.IGNORECASE):
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
def _open_quote(text: str) -> bool:
    """True when text leaves a quotation open: more opening than closing curly quotes, or an odd
    number of straight double quotes."""
    return text.count("\u201c") > text.count("\u201d") or text.count('"') % 2 == 1


def _keep_quotes_whole(sentences: List[str]) -> List[str]:
    """Join sentences that sit inside one quotation, so a quoted passage (a creed, a poem, a
    statute, a speech) is never split across chunks and reaches the model whole."""
    joined, current = [], ""
    for sentence in sentences:
        current = f"{current} {sentence}" if current else sentence
        if not _open_quote(current):
            joined.append(current)
            current = ""
    if current:
        joined.append(current)
    return joined


def chunk_text(text: str, max_length: int = 1500, slides: List[dict] = None) -> List[str]:
    """
    Split text into chunks for processing, respecting slide boundaries when slides are provided.
    If `slides` is given (list of {'title','content'}), prefer returning one chunk per slide.
    Otherwise, fall back to paragraph/sentence chunking.
    """
    if slides:
        chunks = []
        for slide in slides:
            content = slide.get('content', [])
            content_text = '\n'.join(content) if isinstance(content, list) else content
            if not content_text.strip():
                continue
            chunks.append(_slide_block(slide.get('title', ''), content_text))
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
                sentences = _keep_quotes_whole(re.split(r'(?<=[.!?])\s+', para))
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


# --- The source's own structure ---------------------------------------------------------------------
# Slide and page numbers are layout, not subject matter. Left in the text, they turn into questions
# like "What is shown on Slide 5?" or "Which artists are listed for Chapter 1?", which can't be
# answered without the file and test nothing. Markers are stripped before any prompt sees the text;
# questions that still point at the source are rewritten or dropped after generation.

# A line that is only a marker: "--- Slide 5 ---", "Slide 5 of 20", "Page 3", "p. 12", "- 3 -", "4 / 10".
_MARKER_LINE = re.compile(
    r"^[\s\-–—_=*#|\[\]()]*(?:(?:slide|page|pg\.?|p\.)\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?[\s\-–—_=*#|\[\]()]*$", re.I)
# A marker in front of a slide or page title: "Slide 6: Sodium", "Page 3 - Introduction".
_MARKER_PREFIX = re.compile(r"^\s*(?:slide|page)\s*\d{1,4}\s*[:\-–—|.]\s+(?=\S)", re.I)


def strip_structure_markers(text: str) -> str:
    """Text without slide and page markers (PPTX "--- Slide N ---", OCR'd PDF "--- Page N ---",
    running "Page 3 of 12" lines, bare page numbers, "Slide 6:" before a title). A line that only
    mentions a slide ("Slide 3 covers torts") is content and stays. Used on every guide batch."""
    lines = []
    for line in str(text or "").split("\n"):
        if _MARKER_LINE.match(line):
            lines.append("")  # keeps the paragraph break the marker made
        else:
            lines.append(_MARKER_PREFIX.sub("", line))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# The patterns below only ever see text from _checked_text(): whitespace runs collapsed to one space
# and a length cap, so a space is written \s or \s? (never \s* or \s+) and no two quantifiers can
# fight over the same run of spaces. A question saved with 20,000 spaces cannot make them backtrack.
_CHECK_CHARS = 1000  # a long question is checked at its first and last 1000 characters (where attributions sit)

# Words that name the source or a part of it, not the subject. Not "unit", "class", "course" or
# "material": "defined in SI units", "the methods in the class", "the course of the disease".
_SOURCE_NOUN = (r"(?:slide ?decks?|slides?|decks?|pages?|chapters?|sections?|modules?|lectures?|lessons?|"
                r"readings?|handouts?|documents?|presentations?|passages?|excerpts?|texts?|textbooks?|notes|outlines?|"
                r"study guides?|videos?|transcripts?|syllabus|tables?|figures?|diagrams?|charts?|graphs?|"
                r"images?|lists?)")
# What may follow a source noun that is the source itself and not the start of a subject term: the
# end of the clause, or a connector ("the section on torts", "this chapter and the next"). A noun
# that runs on into another word is a term ("the List interface", "a page table", "the document
# object model", "the section 8 voucher"): it names the subject, so it is never a source reference.
# A verb after it ("this table shows") is the source acting, so it counts as a connector.
_BOUNDARY = (r"(?=\s?(?:[?.,;:!)]|$)|\s(?:on|about|of|for|from|and|or|but|that|which|what|who|how|why|by|in|at|"
             r"above|below|here|earlier|before|after|says?|states?|shows?|lists?|covers?|describes?|mentions?|explains?|"
             r"includes?|discusses|contains?|gives?)\b)")
# A numbered part ("Chapter 3", "Section 4.2", "Slide 5"); a number that runs on into a name
# ("Chapter 11 bankruptcy", "Section 2 of the Sherman Act") is the subject, not the source.
_NUMBERED = r"\s?#?\s?\d+(?:\.\d+)*[a-z]?(?=\s?(?:[?.,;:!)]|$|\s(?:and|or|that|which|what|who|how|why)\b))"
_PART = rf"(?:(?:the|this|these|each|our|today'?s)\s)?(?:(?:first|second|third|last|next|previous|current|final)\s)?" \
        rf"{_SOURCE_NOUN}(?:{_NUMBERED}|(?!\s?#?\s?\d){_BOUNDARY})"
_COVERAGE_VERB = (r"(?:listed|covered|discussed|introduced|presented|mentioned|described|named|outlined|reviewed|taught|"
                  r"shown|included|highlighted|identified|summari[sz]ed|assigned|studied|learned|featured|depicted|"
                  r"illustrated|explained|defined|displayed|pictured)")
# What the source contains or shows: "listed for Chapter 1", "covered in this lecture", "the key
# terms for Chapter 3". No rewrite saves these.
_ABOUT_SOURCE = re.compile(
    rf"\b{_COVERAGE_VERB}\s(?:in|on|for|under|during|throughout|from|at|by)\s{_PART}"
    rf"|\b(?:key\s)?(?:terms|vocabulary|concepts|topics|objectives|readings|themes|takeaways)\s(?:for|of|in|from)"
    rf"\s(?:(?:the|this)\s)?(?:chapter|section|module|lecture|lesson|week|part|reading|slide|page)s?"
    rf"(?:{_NUMBERED}|(?!\s?#?\s?\d){_BOUNDARY})",
    re.I)
_POINTS_AT_SOURCE = re.compile(
    # "Slide 5", "page 12", "p. 12", "Figure 2", "Table 3", "Example 2", "Problem 4"
    r"\b(?:slides?|pages?|pp?\.|pg\.?|figures?|fig\.|tables?|exhibits?|examples?|problems?|exercises?)\s?#?\s?\d+"
    # "in Lecture 4", "for Module 2", "during Week 3" (but "week 20 of pregnancy" is a subject)
    r"|\b(?:in|from|during|for|after|before)\s(?:the\s)?(?:modules?|lectures?|lessons?|weeks?)\s\d+\b(?!\sof\b)"
    # "this chapter", "these slides", "the table above", "the following list"
    rf"|\b(?:this|these|the\s(?:above|following|preceding|previous|attached|provided))\s(?:{_SOURCE_NOUN}|course){_BOUNDARY}"
    rf"|\bthe\s{_SOURCE_NOUN}\s(?:above|below)\b"
    # "the lecture says", "listed in the document", "on the slides?" (not "the document object model",
    # nor "the slide" a specimen sits on)
    r"|\bthe\s(?:slides|slide ?deck|lectures?|readings?|handouts?|documents?|study guide|transcripts?|videos?|"
    r"textbook|syllabus)(?=\s?(?:[?.,;:!)]|$)|\s(?:says?|said|states?|stated|shows?|showed|lists?|describes?|mentions?|"
    r"covers?|discusses|explains?|defines?|gives?|gave|presents?|notes?|calls?|uses?|claims?|argues?|suggests?|"
    r"includes?|identifies|highlights?|refers?)\b)"
    # "on the slides", "in the lecture": not "the document in the chart", "the document for informed consent"
    r"|\bthe\s(?:slides|slide ?deck|lectures?|readings?|handouts?|study guide|transcripts?|videos?|"
    r"textbook|syllabus)\s(?:on|in|at|for|about)\b"
    # "listed above", "Which characters are listed?"
    r"|\blisted\s(?:above|below|here|earlier|previously)\b"
    r"|\b(?:is|are|was|were)\s(?:being\s)?(?:listed|shown|described|mentioned|discussed|presented|introduced|"
    r"outlined|highlighted|depicted|illustrated|featured|pictured|displayed)\s?[?.]?\s?$",
    re.I)
_ATTRIBUTION = (r"(?:according to|based on|as (?:stated|described|shown|explained|noted|defined|outlined|discussed|"
                r"listed|seen|mentioned|presented) (?:in|on|by)|in|on|from|per|within|throughout)")
_LEADING = re.compile(rf"^\s?{_ATTRIBUTION}\s{_PART}(?:\s?\([^)]*\))?\s?[,:]\s?", re.I)
_TRAILING = re.compile(rf"\s?,?\s?{_ATTRIBUTION}\s{_PART}\s?(?=[?.!]?\s?$)", re.I)


# Every pattern above needs one of these; most questions have none, so the patterns are skipped
# (guides are parsed on hot paths such as class progress).
_SOURCE_WORDS = (
    "slide", "deck", "page", "p.", "pg", "chapter", "section", "part", "module", "lecture", "lesson", "week", "reading",
    "handout", "document", "presentation", "passage", "excerpt", "text", "notes", "outline", "guide", "video",
    "transcript", "syllabus", "table", "fig", "diagram", "chart", "graph", "image", "list", "exhibit", "example",
    "problem", "exercise", "course", "shown", "described", "presented", "mentioned", "discussed", "introduced", "outlined",
    "highlighted", "depicted", "illustrated", "featured", "pictured", "displayed",
)


def _squash(text) -> str:
    """The text with every run of whitespace (spaces, tabs, newlines) as one space, ends trimmed."""
    return " ".join(str(text or "").split())


def _may_refer(text: str) -> bool:
    lower = text.lower()
    return any(word in lower for word in _SOURCE_WORDS)


def _windows(text: str) -> list:
    """The parts of a squashed text the patterns run on: all of it, or for a long text its first
    and last _CHECK_CHARS characters, so the cost of a check never depends on how long the text is."""
    if len(text) <= 2 * _CHECK_CHARS:
        return [text]
    return [text[:_CHECK_CHARS], text[-_CHECK_CHARS:]]


def refers_to_source(question: str) -> bool:
    """Whether a question is about the source's layout or contents rather than the subject: it
    names a slide, page, figure or numbered lecture, points at "this chapter" or "the lecture", or
    asks what the source lists, covers or shows. Subject terms that share these words stay clear
    ("Chapter 11 bankruptcy", "Section 2 of the Sherman Act", "a page fault", "a listed company")."""
    text = _squash(question)
    return _may_refer(text) and any(
        _ABOUT_SOURCE.search(part) or _POINTS_AT_SOURCE.search(part) for part in _windows(text))


def _sentence_case(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def _without_attribution(text: str) -> str:
    """A squashed text without its leading and trailing attribution (only the ends are touched)."""
    if len(text) <= 2 * _CHECK_CHARS:
        return _TRAILING.sub("", _LEADING.sub("", text)).strip()
    head, middle, tail = text[:_CHECK_CHARS], text[_CHECK_CHARS:-_CHECK_CHARS], text[-_CHECK_CHARS:]
    return (_LEADING.sub("", head) + middle + _TRAILING.sub("", tail)).strip()


def strip_source_attribution(text: str) -> str:
    """Without a leading or trailing "according to Slide 5" / "In this lecture,": what is left is
    about the subject. Used on questions and answers."""
    value = str(text or "").strip()
    squashed = _squash(value)
    if not _may_refer(squashed):
        return value
    stripped = _without_attribution(squashed)
    return _sentence_case(stripped) if stripped and stripped != squashed else value


def standalone_question(question: str):
    """The question as a stand-alone question about the subject, or None when it is about the source
    itself ("Which artists are listed for Chapter 1?", "What is shown on Slide 7?") and no rewrite
    can fix it. "According to Slide 5, what is X?" becomes "What is X?"."""
    text = str(question or "").strip()
    if not text:
        return None
    squashed = _squash(text)
    if not _may_refer(squashed):
        return text
    if any(_ABOUT_SOURCE.search(part) for part in _windows(squashed)):
        return None
    rewritten = strip_source_attribution(text)
    if rewritten != text and not rewritten.endswith("?") and text.endswith("?"):
        rewritten = rewritten.rstrip(".!") + "?"
    if refers_to_source(rewritten) or (rewritten != text and len(rewritten.split()) < 2):
        return None
    return rewritten


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
    for slide in slides:
        content = slide.get('content', [])
        content_text = '\n'.join(content) if isinstance(content, list) else content
        parts.append(_slide_block(slide.get('title', ''), content_text))
    return '\n\n'.join(parts)


def _slide_block(title: str, content_text: str) -> str:
    """One slide for the guide prompt. No slide number and no made-up "Untitled Slide N" title: a
    number in the prompt is what questions like "What is shown on Slide 5?" were written from."""
    title = (title or '').strip()
    heading = f"<TITLE>{title}</TITLE>\n" if title else ""
    return f"<SLIDE>\n{heading}<CONTENT>\n{content_text.strip()}\n</CONTENT>\n</SLIDE>"


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


class _HtmlText(HTMLParser):
    """Collects text; block-level tags become line breaks. One pass, so input size can't blow up the cost."""
    BLOCKS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def _break(self, tag):
        if tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_starttag(self, tag, attrs):
        self._break(tag)

    def handle_endtag(self, tag):
        self._break(tag)

    def handle_startendtag(self, tag, attrs):
        self._break(tag)

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(text: str) -> str:
    """SmartNote HTML as plain text for AI context."""
    if "<" not in (text or ""):
        return text
    parser = _HtmlText()
    parser.feed(text)
    parser.close()
    return "".join(parser.parts)


class _PageText(_HtmlText):
    """A web page's readable text, by the same rules as the app's link reader (NewSheet readLink):
    scripts, styles, navigation, headers, footers, sidebars and forms are left out, and the page's
    <main> or <article> is used when it has one."""
    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "template", "iframe", "head"}
    MAIN = {"main", "article"}

    def __init__(self):
        super().__init__()
        self.skipping = 0
        self.in_main = 0
        self.main_parts = []
        self.title = []
        self.in_title = False

    def _break(self, tag):
        if tag in self.BLOCKS:
            self.parts.append("\n")
            if self.in_main:
                self.main_parts.append("\n")

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP:
            self.skipping += 1
        elif tag in self.MAIN:
            self.in_main += 1
        self._break(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP:
            self.skipping = max(0, self.skipping - 1)
        elif tag in self.MAIN:
            self.in_main = max(0, self.in_main - 1)
        self._break(tag)

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.skipping:
            return
        self.parts.append(data)
        if self.in_main:
            self.main_parts.append(data)


def page_text(html: str) -> Tuple[str, str]:
    """(title, readable text) of a web page."""
    parser = _PageText()
    parser.feed(html or "")
    parser.close()
    main = "".join(parser.main_parts).strip()
    text = main if len(main) >= 200 else "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return re.sub(r"\s+", " ", "".join(parser.title)).strip(), text


_MD_HEADING = re.compile(r"^#{1,6}\s+(\S.*)$")
_BULLET = re.compile(r"^(?:[-*•▪◦·]|\d{1,2}[.)])\s+(\S.*)$")


def _looks_like_heading(line: str, following: str) -> bool:
    """A short line without closing punctuation, followed by longer text: a section title."""
    return (3 <= len(line) <= 80 and not line.endswith((".", ",", ";", ":", "?", "!")) and len(line.split()) <= 10
            and bool(following) and len(following) > len(line))


def text_to_outline(text: str, max_points: int = 400) -> str:
    """Document or slide text as the outline guides use ("## Heading" then "- point" lines), so an
    imported file opens in Library ready to read and to make cards from. Slides keep their titles
    as headings; long paragraphs become one point each."""
    text = clean_text(text or "")
    if not text.strip():
        return ""
    lines_out: List[str] = []
    is_slides, _ = is_slideshow_content(text)
    if is_slides:
        for slide in extract_slideshow_content(text):
            lines_out.append(f"## {slide['title'][:120] or 'Slide'}")
            lines_out.extend(f"- {line[:600]}" for line in slide["content"] if line.strip())
    else:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            following = lines[index + 1] if index + 1 < len(lines) else ""
            heading = _MD_HEADING.match(line)
            bullet = _BULLET.match(line)
            if heading:
                lines_out.append(f"## {heading.group(1).strip()[:120]}")
            elif bullet:
                lines_out.append(f"- {bullet.group(1).strip()[:600]}")
            elif _looks_like_heading(line, following):
                lines_out.append(f"## {line}")
            else:
                lines_out.append(f"- {line[:600]}")
    points = 0
    kept = []
    for line in lines_out:
        if line.startswith("- "):
            points += 1
            if points > max_points:
                break
        kept.append(line)
    # A heading with nothing under it adds nothing.
    return "\n".join(line for index, line in enumerate(kept)
                     if not line.startswith("## ") or (index + 1 < len(kept) and kept[index + 1].startswith("- ")))


_CHANGE_WORDS = re.compile(
    r"\b(?:due|deadline|extension|extended|extend|postpone[sd]?|reschedul\w*|moved?|push(?:ed)? back|delay(?:ed)?|cancel(?:l?ed)?|"
    r"exam|quiz|test|midterm|final|assignment|paper|project|presentation|lab)\b", re.I)
_DATE_WORDS = re.compile(
    r"\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|"
    r"\b\d{1,2}/\d{1,2}\b|\btomorrow\b|\bnext week\b|\bnoon\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b", re.I)


def mentions_date_change(text: str) -> bool:
    """A cheap first pass before any AI reads a message: it has to talk about schoolwork timing
    (a deadline word and a date or time). Most mail stops here."""
    sample = (text or "")[:8000]
    return bool(_CHANGE_WORDS.search(sample) and _DATE_WORDS.search(sample))


# Titles arrive as whatever the source was called: a file name ("Nickels_UB2024_PPT_Ch01.pptx"), a
# browser tab ("Chapter 6 Counting - CS 201 - Canvas"), or several file names joined for one guide.
_FILE_EXT = re.compile(r"\.(?:pdf|pptx?|docx?|key|pages|rtf|txt|md|html?|odt|odp)$", re.I)
_SITE_PARTS = re.compile(
    r"^(?:canvas|instructure|blackboard(?: learn)?|moodle|d2l|brightspace|quizlet|wikipedia|youtube|google (?:docs|drive|slides)|"
    r"onedrive|sharepoint|notion|pearson|mylab|mcgraw hill|connect|chegg|course ?hero|study guide)$", re.I)
_FILE_WORDS = re.compile(
    r"\b(?:pdf|pptx?|docx?|powerpoint|ppt slides|underlined|accessible|student version|final version|copy of|copy|v\d+)\b", re.I)
_TERM_WORDS = re.compile(r"\b(?:fa|sp|su|wi|fall|spring|summer|winter)\s?'?(?:20)?\d{2}\b", re.I)
# Titles are whitespace-collapsed before these run, so single literal spaces keep every match linear.
_TRAILING_KIND = re.compile(r"(?: ?[-—–:|])? ?(?:study guide|flashcards?|flash cards?|wikipedia|quizlet)$", re.I)
_LABEL_WORDS = re.compile(
    r"\b(?:chapter|ch|unit|module|mod|week|wk|lecture|lec|class|day|exam|test|quiz|midterm|final|lesson|part|section|topic|"
    r"session|review|notes?|slides?|student|answers?|questions?|readings?|homework|pledge)\b", re.I)
_GENERIC_TITLE = re.compile(
    r"^(?:untitled(?: notes)?|notes|study guide|custom study guide|document|file preview|homework|reading|readings|slides?|page|lecture|"
    r"(?:chapter|ch|unit|module|mod|week|wk|lecture|lec|class|day|exam|test|quiz|midterm|final|lesson|part|section|topic|session)"
    r" ?\.? ?[\w.]{0,4}(?: (?:review|notes|slides|mc|hy|student|pdf|answers|questions))*)$", re.I)


def clean_title(raw: str) -> str:
    """The name of the source with file and site leftovers taken off, for showing to a student."""
    title = " ".join(str(raw or "").split())[:300]
    if " " not in title:
        title = re.sub(r"(?<=\w)[+_.-](?=\w)", " ", title.rsplit(".", 1)[0] if _FILE_EXT.search(title) else title)
    title = _FILE_EXT.sub("", title).replace("_", " ")
    title = re.sub(r"\b[a-z]+(?:-[a-z]+){2,}\b", lambda m: m.group(0).replace("-", " "), title)  # file-name-slugs
    title = re.sub(r" ?\(\d\) ?| 0$", " ", title)  # "(1)" copies, "Manual 0"
    if " + " in title:  # Several files in one guide: the first names it until something better does.
        title = title.split(" + ", 1)[0]
    # "Chapter 6 Counting - CS 201 - Canvas": drop the parts that name the site, not the material.
    parts = [p for p in re.split(r" [-|–—] ", title) if p.strip() and not _SITE_PARTS.match(p.strip())]
    title = " - ".join(parts) if parts else title
    title = " ".join(_TERM_WORDS.sub(" ", _FILE_WORDS.sub(" ", title)).split())
    for _ in range(2):
        stripped = _TRAILING_KIND.sub("", title).strip(" -—–:|,")
        title = stripped if stripped else title
    title = re.sub(r"\s+", " ", title).strip(" -—–:|,")
    if title and title == title.lower():
        title = title[0].upper() + title[1:]
    return title[:120]


def weak_title(raw: str) -> bool:
    """True when a title doesn't say what the material is about: a generic label ("Chapter 7",
    "Exam 2 MC"), a file name, several sources glued together, or mostly codes."""
    raw = " ".join(str(raw or "").split())[:300]
    title = clean_title(raw)
    if not title or _GENERIC_TITLE.match(title) or " + " in raw or len(title) > 70:
        return True
    if _FILE_EXT.search(raw) or (" " not in raw and re.search(r"[_+]|\w-\w", raw)) or raw == raw.lower():
        return True
    # What's left once labels ("Chapter 6", "Exam 2 Review") and codes ("ACC 371", "UB2024") are taken off
    # has to name a subject.
    words = re.findall(r"[A-Za-z][A-Za-z'’]+", _LABEL_WORDS.sub(" ", title))
    subject = [w for w in words if len(w) >= 3 and not (w.isupper() and len(w) <= 4)]
    return len(subject) < 2 or len(subject) < len(title.split()) / 3


def shown_questions(questions):  # placeholder until the display layer lands (test-first)
    return questions
