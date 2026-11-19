"""
Text processing utilities for content extraction and cleaning.
Handles LMS content, slideshows, and general educational material.
"""

import re
import logging
from functools import lru_cache
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
    # A day ("Mon", "Tuesday, Nov 18"), not a word that starts like one ("Monet", "Sunflowers", "Saturn")
    if re.match(r'^(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b', text_lower) and len(text_lower) < 20:
        return True
    if text_lower.startswith('http') or text_lower.startswith('www'):  # URLs
        return True

    return False


# A line that is only a value: a number, year, amount, ratio, range or step number ("4000", "1789",
# "3/4", "135-145", "98.6", "12,000", "(2)"). It is as often the fact itself as a page number, so the
# filters below that drop number-only lines let it through. It stays exactly where it is: whether a
# year belongs to the line above it ("The Starry Night" / "1889") or below it ("1789" / "Storming of
# the Bastille") can't be told from the text, and joining it to either would pin it to the wrong
# entry half the time. In place, the guide model reads it in its context.
_VALUE_LINE = re.compile(r"^\(?\d[\d.,/:%\-–]{0,15}\)?$")


def is_value_line(line: str) -> bool:
    return bool(_VALUE_LINE.match(line))


def _beside_value(lines: List[str], index: int) -> bool:
    return any(0 <= at < len(lines) and is_value_line(lines[at]) for at in (index - 1, index + 1))


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
            if is_value_line(line) or not is_navigation_text(line):
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

    for index, line in enumerate(non_empty_lines):
        # A value ("1789", "4000", "7") is kept, though the checks below would take it for a page number
        if is_value_line(line):
            cleaned_lines.append(line)
            continue

        # Skip navigation elements
        if is_navigation_text(line):
            continue

        # Skip very short lines unless they're headers, or name the value beside them ("Sula" / "1973"):
        # dropping that name would leave its value next to another entry's
        if len(line) < 5 and not line.endswith(':') and not _beside_value(non_empty_lines, index):
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
            if is_value_line(line):
                cleaned_lines.append(line)
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

# The owner's rule: only a line that is exactly a known marker is removed, and nothing else is
# joined, moved, changed or removed, so a lone year or dose ("1789", "4000", "3/4") stays where it
# was. The markers: a slide or page number ("Slide 5", "Slide 4 of 20", "5 / 20", "Page 3", "Page 3
# of 12", "p. 12", "pg. 4"), alone or decorated as PPTX and PDF text sends it ("--- Slide 5 ---",
# "--- Page 2 ---", "[Page 3]"), a page number between dashes ("- 3 -", "— 7 —") and an "Untitled
# Slide N" title. Not "3 of 12" or "12" alone (as often a fact), and not a line that starts with a
# marker ("Slide 6: Sodium balance"), which is a title and stays whole.
# Every repetition is bounded, so the pattern is linear in the text whatever it holds; it runs once
# over the whole text (a captured page is at most 500,000 characters).
_DECOR = r"[ \t\-\u2013\u2014_=*#|\[\]()]{0,40}"
_GAP = r"[ \t]{0,3}"
_NUMBER = r"\d{1,4}"
_MARKER_LINES = re.compile(
    r"^(?=[^\n\d]{0,60}\d)(?:"  # every marker has a number near its start: other lines are passed over at once
    rf"{_DECOR}(?:slide|page|pg\.?|p\.){_GAP}{_NUMBER}(?:{_GAP}(?:of|/){_GAP}{_NUMBER})?{_DECOR}"
    rf"|{_GAP}{_NUMBER}[ \t]{{1,3}}/[ \t]{{1,3}}{_NUMBER}{_GAP}"
    rf"|{_GAP}[\-\u2013\u2014]{{1,3}}{_GAP}{_NUMBER}{_GAP}[\-\u2013\u2014]{{1,3}}{_GAP}"
    rf"|{_GAP}untitled slide{_GAP}{_NUMBER}{_GAP}"
    r")\r?(?:\n|\Z)",
    re.I | re.M)


def strip_structure_markers(text: str) -> str:
    """The text without its slide and page marker lines (_MARKER_LINES), every other line exactly
    as it was, in its place. Used on every guide batch, for slideshows, web pages, PDFs (text and
    scanned) and PPTX alike."""
    text = str(text or "")
    stripped = _MARKER_LINES.sub("", text)
    if stripped.endswith("\n") and not text.endswith("\n") and len(stripped) < len(text):
        stripped = stripped[:-1]  # the last line was a marker: its line break goes with it
    return stripped


# The patterns below only ever see text from _checked_text(): whitespace runs collapsed to one space
# and a length cap, so a space is written \s or \s? (never \s* or \s+) and no two quantifiers can
# fight over the same run of spaces. A question saved with 20,000 spaces cannot make them backtrack.
_CHECK_CHARS = 1000  # a long question is checked at its first and last 1000 characters (where attributions sit)

# Words that name the source or a part of it, not the subject. Not "unit", "class", "course" or
# "material": "defined in SI units", "the methods in the class", "the course of the disease". A
# chart is only the source when it is pointed at ("this chart", "Chart 3"): "the chart" is as often
# a patient's record ("the vital signs shown in the chart").
# Pictures, charts and tables: a question pointed at one needs it in front of the student, so no
# rewrite saves it ("Based on the graph, what is the equilibrium price?").
_VISUAL_NOUNS = ("tables?", "figures?", "diagrams?", "graphs?", "images?", "maps?", "photos?", "photographs?",
                 "pictures?", "illustrations?", "exhibits?")
_NOUNS = ("slide ?decks?", "slides?", "decks?", "pages?", "chapters?", "sections?", "modules?", "lectures?", "lessons?",
          "readings?", "handouts?", "documents?", "presentations?", "passages?", "excerpts?", "texts?", "textbooks?",
          "notes", "outlines?", "study guides?", "videos?", "transcripts?", "syllabus", *_VISUAL_NOUNS, "lists?")
_SOURCE_NOUN = "(?:" + "|".join((*_NOUNS, "charts?")) + ")"
_PART_NOUN = "(?:" + "|".join(_NOUNS) + ")"
_VISUAL = re.compile(r"\b(?:" + "|".join((*_VISUAL_NOUNS, "charts?", r"fig\.")) + r")(?![\w-])", re.I)
# "of" + a name is the subject ("the first section of the Uniform Commercial Code", "Problem 4 of
# Hilbert's problems"); "of 12", "of the reading" is still the source.
_OF_A_NAME = r"\sof\s(?:the\s)?(?-i:[A-Z])"
# What may follow a source noun that is the source itself and not the start of a subject term: the
# end of the clause, or a connector ("the section on torts", "this chapter and the next"). A noun
# that runs on into another word is a term ("the List interface", "a page table", "the document
# object model", "the section 8 voucher"): it names the subject, so it is never a source reference.
# A verb after it ("this table shows") is the source acting, so it counts as a connector.
_BOUNDARY = (rf"(?=\s?(?:[?.,;:!)]|$)|(?!{_OF_A_NAME})\s(?:on|about|of|for|from|and|or|but|that|which|what|who|how|why|by|in|at|"
             r"above|below|here|earlier|before|after|says?|states?|shows?|lists?|covers?|describes?|mentions?|explains?|"
             r"includes?|discusses|contains?|gives?)\b)")
# A numbered part ("Chapter 3", "Section 4.2", "Slide 5"); a number that runs on into a name
# ("Chapter 11 bankruptcy", "Section 2 of the Sherman Act") is the subject, not the source.
_NUMBERED = r"\s?#?\s?\d+(?:\.\d+)*[a-z]?(?=\s?(?:[?.,;:!)]|$|\s(?:and|or|that|which|what|who|how|why)\b))"
_PART = rf"(?:(?:the|this|these|each|our|today'?s)\s)?(?:(?:first|second|third|last|next|previous|current|final)\s)?" \
        rf"(?:{_PART_NOUN}(?:{_NUMBERED}|(?!\s?#?\s?\d){_BOUNDARY})|charts?{_NUMBERED})"
# What a source does with an idea: "listed for Chapter 1", "covered in this lecture" (the source's
# contents) and "As reviewed in the lecture, ..." (an attribution) use the same list.
_COVERAGE_VERB = (r"(?:listed|covered|discussed|introduced|presented|mentioned|described|named|outlined|reviewed|taught|"
                  r"shown|included|highlighted|identified|summari[sz]ed|assigned|studied|learned|featured|depicted|"
                  r"illustrated|explained|defined|displayed|pictured|stated|noted|seen|emphasi[sz]ed|addressed|"
                  r"examined|explored)")
# The source, or the person presenting it, as the one acting: "the excerpt introduces", "does the
# chapter compare", "the lecturer gives". Not "the document for informed consent", "the text editor".
_ACTOR = (r"(?:slides|slide ?deck|lectures?|lecturer|professor|instructor|teacher|readings?|handouts?|documents?|"
          r"study guide|transcripts?|videos?|textbook|syllabus|excerpts?|chapters?|modules?|passages?|articles?|"
          r"presentations?|lessons?)")
_ACTS = (r"(?:say|state|show|list|describe|mention|cover|discuss|explain|define|present|include|identify|use|suggest|"
         r"argue|reveal|claim|emphasi[sz]e|note|outline|feature|compare|contrast|cite|offer|provide|give|introduce|"
         r"highlight|focus|recommend|imply|conclude|propose|depict|illustrate|summari[sz]e|examine|explore|address|"
         r"teach|call|refer|name)")
# What the source contains or shows: "listed for Chapter 1", "covered in this lecture", "the key
# terms for Chapter 3". No rewrite saves these.
_ABOUT_SOURCE = re.compile(
    rf"\b{_COVERAGE_VERB}\s(?:in|on|for|under|during|throughout|from|at|by)\s{_PART}"
    rf"|\b(?:key\s)?(?:terms|vocabulary|concepts|topics|objectives|readings|themes|takeaways)\s(?:for|of|in|from)"
    rf"\s(?:(?:the|this)\s)?(?:chapter|section|module|lecture|lesson|week|part|reading|slide|page)s?"
    rf"(?:{_NUMBERED}|(?!\s?#?\s?\d){_BOUNDARY})",
    re.I)
_POINTS_AT_SOURCE = re.compile(
    # "Slide 5", "page 12", "p. 12", "Figure 2", "Table 3", "Example 2", "Problem 4" (not "Problem 4 of
    # Hilbert's problems")
    rf"\b(?:slides?|pages?|pp?\.|pg\.?|figures?|fig\.|tables?|charts?|exhibits?|examples?|problems?|exercises?)\s?#?\s?\d+(?!\d|{_OF_A_NAME})"
    # "in Lecture 4", "for Module 2", "during Week 3" (but "week 20 of pregnancy" is a subject)
    r"|\b(?:in|from|during|for|after|before)\s(?:the\s)?(?:modules?|lectures?|lessons?|weeks?)\s\d+\b(?!\sof\b)"
    # "this chapter", "these slides", "the table above", "the following list"
    rf"|\b(?:this|these|the\s(?:above|following|preceding|previous|attached|provided))\s(?:{_SOURCE_NOUN}|course){_BOUNDARY}"
    rf"|\bthe\s{_SOURCE_NOUN}\s(?:above|below)\b"
    # "the lecture says", "the professor says", "the slides?" (not "the document object model",
    # nor "the slide" a specimen sits on)
    rf"|\bthe\s{_ACTOR}(?=\s?(?:[?.,;:!)]|$)|\s(?:says?|said|states?|stated|shows?|showed|lists?|describes?|mentions?|"
    r"covers?|discusses|explains?|defines?|gives?|gave|presents?|notes?|calls?|uses?|claims?|argues?|suggests?|"
    r"includes?|identifies|highlights?|refers?|introduces?|compares?|reveals?)\b)"
    # "What does the professor say about heparin?", "Which characters does the excerpt introduce?"
    rf"|\b(?:does|do|did)\s(?:the|this|these|that)\s{_ACTOR}\s{_ACTS}\b"
    # "on the slides", "in the lecture": not "the document in the chart", "the document for informed consent"
    r"|\bthe\s(?:slides|slide ?deck|lectures?|readings?|handouts?|study guide|transcripts?|videos?|"
    r"textbook|syllabus)\s(?:on|in|at|for|about)\b"
    # "the professor's example", "the instructor's point" (not "the clinical instructor's responsibility")
    r"|\bthe\s(?:professor|instructor|lecturer|teacher)'s\s(?:examples?|points?|explanations?|analog(?:y|ies)|"
    r"stor(?:y|ies)|demonstrations?|notes|comments?|definitions?|summary|opinions?|arguments?)\b"
    # "listed above", "Which characters are listed?"
    r"|\blisted\s(?:above|below|here|earlier|previously)\b"
    r"|\b(?:is|are|was|were)\s(?:being\s)?(?:listed|shown|described|mentioned|discussed|presented|introduced|"
    r"outlined|highlighted|depicted|illustrated|featured|pictured|displayed)\s?[?.]?\s?$",
    re.I)
# "Which drug is listed first?": the order of the file. Not when the question names what the order
# is in ("In the Bill of Rights, which freedom is listed first?", "In Maslow's hierarchy, ...").
_LISTED_ORDINAL = re.compile(
    r"\b(?:is|are|was|were)\s(?:listed|shown|mentioned|named|presented|given|introduced)\s"
    r"(?:first|second|third|last|next)\s?[?.]?\s?$", re.I)
_NAMED_CONTEXT = re.compile(r"^\s?(?:in|under|within|among|for|of|on)\s[^,]{1,80},", re.I)
# "In the image of the Parthenon, ...", "On the map of Europe, ...": a picture of a named thing.
# Not a graph, chart or table of one ("the graph of y = x^2", "the table of contents").
_VISUAL_OF = re.compile(
    r"^\s?(?:in|on|from|based on|according to|using|looking at)\s(?:the|this|these|each)\s"
    r"(?:images?|photos?|photographs?|pictures?|illustrations?|diagrams?|maps?)\s(?:of|above|below)\b[^,?]{0,80},", re.I)
# "According to Slide 5", "As discussed in the lecture", "per the syllabus": an attribution wherever
# it sits. A bare "in the slides" is one only before a comma or at the start ("In this lecture, ..."):
# at the end it may belong to the question ("Which poets are mentioned in the passage?").
_FRAMING = rf"(?:according to|based on|as {_COVERAGE_VERB} (?:in|on|by)|per)"
_ATTRIBUTION = rf"(?:{_FRAMING}|in|on|from|within|throughout)"
# "As discussed in class": class is the source only bare, after a framing verb ("the class" is often
# the subject: "the methods in the class").
_IN_CLASS = rf"as {_COVERAGE_VERB} in class(?![\w-])"
_LEADING = re.compile(rf"^\s?(?:{_ATTRIBUTION}\s{_PART}(?:\s?\([^)]*\))?|{_IN_CLASS})\s?[,:]\s?", re.I)
_TRAILING_FRAMED = re.compile(
    rf"(?:\s?,\s?\b{_ATTRIBUTION}\s{_PART}|\s?\b{_FRAMING}\s{_PART}|\s?,?\s?\b{_IN_CLASS})\s?(?=[?.!]?\s?$)", re.I)
_TRAILING = re.compile(rf"\s?,?\s?\b{_ATTRIBUTION}\s{_PART}\s?(?=[?.!]?\s?$)", re.I)
# What is left of a rewrite that still needs the file: only an ordinal or a generic noun ("What is
# the second step?", "What does the first bullet say?", "What is the author's main argument?",
# "Which painting appears first?").
_GENERIC = re.compile(
    r"^(?:what|which|name|list|give|identify|state)\s(?:(?:is|are|was|were|does|do|did)\s)?(?:(?:the|a|an)\s)?"
    r"(?:(?:author|writer|speaker|lecturer|instructor|professor|text|passage|reading|chapter|article)(?:'s|s'|s)?\s)?"
    r"(?:(?:first|second|third|fourth|fifth|last|final|next|previous|other|main|central|key|primary|overall|"
    r"one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s)*"
    r"(?:items?|steps?|terms?|bullets?(?:\spoints?)?|points?|examples?|ideas?|arguments?|claims?|themes?|topics?|"
    r"messages?|takeaways?|conclusions?|thesis|parts?|entries|entry|lines?|words?|sentences?|paragraphs?|"
    r"questions?|answers?|options?|things?|ones?)"
    r"(?:\s(?:say|says|said|show|shows|state|states|mean|means|describe|describes|list|lists))?\s?[?.!]?$"
    r"|^(?:what|which)\s(?:[\w'-]+\s){1,3}(?:(?:appears?|comes?|is|are|was|were)\s)(?:(?:listed|shown|mentioned|named)\s)?"
    r"(?:first|second|third|last|next)\s?[?.!]?$",
    re.I)


# Every pattern above needs one of these; most questions have none, so the patterns are skipped
# (guides are parsed on hot paths such as class progress).
_SOURCE_WORDS = (
    "slide", "deck", "page", "p.", "pg", "chapter", "section", "part", "module", "lecture", "lesson", "week", "reading",
    "handout", "document", "presentation", "passage", "excerpt", "text", "notes", "outline", "guide", "video",
    "transcript", "syllabus", "table", "fig", "diagram", "chart", "graph", "image", "list", "exhibit", "example",
    "problem", "exercise", "course", "shown", "described", "presented", "mentioned", "discussed", "introduced", "outlined",
    "highlighted", "depicted", "illustrated", "featured", "pictured", "displayed", "professor", "instructor", "teacher",
    "article", "map", "photo", "picture", "class", "listed", "named", "given",
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
    names a slide, page, figure or numbered lecture, points at "this chapter" or "the lecture", has
    the source acting ("does the excerpt introduce"), or asks what the source lists, covers or
    shows. Subject terms that share these words stay clear ("Chapter 11 bankruptcy", "Section 2 of
    the Sherman Act", "a page fault", "a listed company", "the vital signs in the chart")."""
    text = _squash(question)
    if not _may_refer(text):
        return False
    if any(_ABOUT_SOURCE.search(part) or _POINTS_AT_SOURCE.search(part) for part in _windows(text)):
        return True
    return bool(_LISTED_ORDINAL.search(_windows(text)[-1])) and not _NAMED_CONTEXT.match(text)


def _sentence_case(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


# Stacked attributions ("In the lecture, in Chapter 3, what is X?") come off one per end per pass. A
# real question has two or three; three passes bound the work on hostile text (a question that is the
# same attribution repeated), and whatever is left is still checked for pointing at the source.
_MAX_PASSES = 3


def _until_stable(text: str, leading, trailing, taken: list) -> str:
    """`text` with attributions taken off its start and end (added to `taken`), pass after pass
    until none is left or _MAX_PASSES passes have run."""
    for _ in range(_MAX_PASSES):
        stripped = text
        found = leading.search(stripped)
        if found:
            taken.append(found.group())
            stripped = stripped[found.end():].strip()
        found = trailing.search(stripped)
        if found:
            taken.append(found.group())
            stripped = (stripped[:found.start()] + stripped[found.end():]).strip()
        if stripped == text:
            break
        text = stripped
    return text


def _without_attribution(text: str, trailing=_TRAILING, taken=None) -> str:
    """A squashed text without its leading and trailing attributions (only the ends are touched).
    What was taken off is added to `taken` when it is given."""
    taken = [] if taken is None else taken
    if len(text) <= 2 * _CHECK_CHARS:
        return _until_stable(text, _LEADING, trailing, taken)
    head, middle, tail = text[:_CHECK_CHARS], text[_CHECK_CHARS:-_CHECK_CHARS], text[-_CHECK_CHARS:]
    return (_until_stable(head, _LEADING, _NOTHING, taken) + middle + _until_stable(tail, _NOTHING, trailing, taken)).strip()


_NOTHING = re.compile(r"(?!)")


def strip_source_attribution(text: str) -> str:
    """Without a leading or trailing "according to Slide 5" / "In this lecture,": what is left is
    about the subject. Used on questions and answers."""
    value = str(text or "").strip()
    squashed = _squash(value)
    if not _may_refer(squashed):
        return value
    stripped = _without_attribution(squashed)
    return _sentence_case(stripped) if stripped and stripped != squashed else value


_CACHED_CHARS = 2000  # questions this long or shorter are remembered (a quiz is read on every Learn, Study now and print)


def standalone_question(question: str):
    """The question as a stand-alone question about the subject, or None when it is about the source
    itself ("Which artists are listed for Chapter 1?", "What is shown on Slide 7?") and no rewrite
    can fix it. "According to Slide 5, what is X?" and "As discussed in the lecture, what is X?"
    become "What is X?"; a rewrite left with only an ordinal or a generic noun ("What is the second
    step?") still needs the file, and one whose attribution was a picture, chart or table ("Based
    on the graph, ...") still needs that, so both are None. Running it again changes nothing."""
    text = str(question or "").strip()
    if not text:
        return None
    if len(text) <= _CACHED_CHARS:
        return _standalone_cached(text)
    return _standalone(text)


def _standalone(text: str):
    squashed = _squash(text)
    if not _may_refer(squashed):
        return text
    if _VISUAL_OF.match(squashed[:_CHECK_CHARS]):
        return None
    # The attribution comes off first: "As discussed in the lecture, what is X?" is about X.
    taken = []
    framed = _without_attribution(squashed, _TRAILING_FRAMED, taken)
    if any(_ABOUT_SOURCE.search(part) for part in _windows(framed)):
        return None
    rewritten = _without_attribution(framed, _TRAILING, taken)
    if rewritten == squashed:
        return None if refers_to_source(text) else text
    if any(_VISUAL.search(part) for part in taken):
        return None
    rewritten = _sentence_case(rewritten)
    if text.endswith("?") and not rewritten.endswith("?"):
        rewritten = rewritten.rstrip(".!") + "?"
    if len(rewritten.split()) < 2 or refers_to_source(rewritten) or any(_GENERIC.search(part) for part in _windows(rewritten)):
        return None
    return rewritten


_standalone_cached = lru_cache(maxsize=4096)(_standalone)


def asked_as(question) -> str:
    """The wording to put to a model or a person: the stand-alone question, or the saved text when
    there is none (a question about the source is never asked, but its text still names the idea)."""
    text = str(question or "")
    return standalone_question(text) or text


def shown_questions(questions):
    """The quiz as the student sees it, for a response: the same list, in the same order, with
    `shown` on a question whose wording asks about the source ("According to Slide 5, what is X?"
    is shown as "What is X?") and `hidden` on one about the source itself ("Which artists are listed
    for Chapter 1?"), which keeps its place but is never asked. The saved `question` text is never
    changed: Learn levels, answer logs, misses and idea ids are keyed by it, and attempts by
    position. A quiz that would have nothing left to ask is shown as it is, never as an empty quiz."""
    if not isinstance(questions, list):
        return questions
    out, hidden = [], 0
    for question in questions:
        if not isinstance(question, dict):
            out.append(question)
            continue
        item = {key: value for key, value in question.items() if key not in ("shown", "hidden")}
        text = item.get("question")
        if isinstance(text, str):
            standalone = standalone_question(text)
            if standalone is None:
                item["hidden"] = True
                hidden += 1
            elif standalone != text:
                item["shown"] = standalone
        out.append(item)
    if hidden and not any(isinstance(item, dict) and not item.get("hidden") and _has_answer(item) for item in out):
        return [{key: value for key, value in item.items() if key != "hidden"} if isinstance(item, dict) else item
                for item in out]
    return out


def _has_answer(question: dict) -> bool:
    """Whether a saved question has an answer to check (retain.concept_answer is not empty)."""
    options, index = question.get("options"), question.get("correct_index")
    return isinstance(options, list) and isinstance(index, int) and 0 <= index < len(options) and bool(str(options[index]).strip())


def shown_guide(row):
    """A study_guides row for a response: its quiz_questions as shown_questions marks them. Every
    route that returns a guide's quiz sends it through here (or through shown_questions), so Study
    now, the Dashboard and Learn read the same wording and the same hidden questions."""
    if isinstance(row, dict) and isinstance(row.get("quiz_questions"), list):
        return {**row, "quiz_questions": shown_questions(row["quiz_questions"])}
    return row


def shown_pairs(pairs: list) -> list:
    """Q/A pairs for a page that only shows them (a printed quiz), each in its place, so an item's
    `source` is the same index in the saved pairs and the saved quiz: reworded like shown_questions,
    and `hidden` on one about the source, which the page leaves out. None hidden when all would be."""
    pairs = list(pairs or [])
    marks = shown_questions([{"question": pair.get("question"), "options": [pair.get("answer") or ""], "correct_index": 0} for pair in pairs])
    return [{**pair, "question": mark.get("shown", pair.get("question")), **({"hidden": True} if mark.get("hidden") else {})}
            for pair, mark in zip(pairs, marks)]


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
    number in the prompt is what questions like "What is shown on Slide 5?" were written from. A
    title that is only a marker ("Slide 5", "Untitled Slide 3") is no title."""
    title = (title or '').strip()
    heading = f"<TITLE>{title}</TITLE>\n" if title and not _MARKER_LINES.match(title) else ""
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
