"""A Notion page's text, for Settings > Connectors imports and the Tutor.

Notion hands a page back as a tree of blocks: the page's own children first, then each block's
children through another call (a toggle's contents, a bullet's sub-bullets, a column, a table's rows).
Every text-bearing block type is read, long pages are read page by page, and nested children are
followed level by level, a few calls at a time (PARALLEL), so a page with many toggles isn't read one
call after another. The clock is the real limit: TIME_BUDGET seconds for the whole read, with caps on
depth, calls and blocks behind it so one page can't run away. When a limit stops the read, the result
says so (PageRead.partial, and a plain last line in the text): nothing is dropped silently. Composio
returns the list as Notion does ({"results": [...]}) or wrapped one level down ({"block_child_data":
{...}}); both are read. The tree is read-only: nothing here writes to Notion.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from typing import Callable, Optional

from fastapi import HTTPException

from services import composio

log = logging.getLogger(__name__)

TIME_BUDGET = 25.0  # seconds for one page, all calls together (the browser waits two minutes)
MAX_DEPTH = 6       # levels of children below the page that are followed
MAX_CALLS = 250     # Notion calls for one page, including the first
MAX_BLOCKS = 5000   # blocks read for one page
PARALLEL = 4        # calls in flight at once
# The Tutor reads one page per message and answers while the student waits: one budget for the
# searches and the page together.
TUTOR_TIME_BUDGET = 20.0
TUTOR_MAX_CALLS = 40
PAGE_SIZE = 100
SLUG = "NOTION_FETCH_BLOCK_CONTENTS"

# Response keys that hold the list of blocks, and the keys a response can be wrapped in.
_LISTS = ("results", "blocks", "children", "items")
_WRAPPERS = ("block_child_data", "data", "response", "result")

_HEADINGS = {"heading_1": 1, "heading_2": 2, "heading_3": 3, "heading_4": 4}
_BULLETS = {"bulleted_list_item", "to_do", "toggle"}
# Blocks that only hold other blocks (or are pointers/dividers): they add no line of their own and
# their children sit at the same indent. Child pages are separate pages: their titles are listed
# ("Sub-page: Lecture 3") but they are not read into this one.
_CONTAINERS = {"column_list", "column", "synced_block", "template", "table"}
_SUBPAGES = {"child_page": "Sub-page", "child_database": "Database"}
_SKIPPED = {"link_to_page", "divider", "breadcrumb", "table_of_contents", "unsupported"}
_CAPTIONED = {"image", "video", "file", "pdf", "audio", "bookmark", "embed", "link_preview"}


def _plain(parts) -> str:
    """The text of a rich_text array (or a bare string), whatever shape its pieces have."""
    if isinstance(parts, str):
        return parts.strip()
    if not isinstance(parts, list):
        return ""
    out = []
    for part in parts:
        if isinstance(part, str):
            out.append(part)
        elif isinstance(part, dict):
            inner, equation = part.get("text"), part.get("equation")
            text = (part.get("plain_text")
                    or (inner.get("content") if isinstance(inner, dict) else inner)
                    or (equation.get("expression") if isinstance(equation, dict) else None))
            if isinstance(text, str):
                out.append(text)
    return "".join(out).strip()


def _cursor(data: dict) -> Optional[str]:
    cursor = data.get("next_cursor")
    return cursor if data.get("has_more") and isinstance(cursor, str) and cursor else None


def _listing(data, depth: int = 0) -> tuple[list, Optional[str]]:
    """(blocks, next cursor) from one response, however Composio wrapped it."""
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)], None
    if not isinstance(data, dict) or depth > 3:
        return [], None
    for key in _LISTS:
        if isinstance(data.get(key), list):
            return [item for item in data[key] if isinstance(item, dict)], _cursor(data)
    for key in _WRAPPERS:
        if isinstance(data.get(key), (dict, list)):
            blocks, cursor = _listing(data[key], depth + 1)
            if blocks or cursor:
                return blocks, cursor or _cursor(data)
    return [], None


def _kind(block: dict) -> str:
    kind = block.get("type")
    if isinstance(kind, str) and isinstance(block.get(kind), dict):
        return kind
    # No usable type: the block's own key says what it is.
    known = {*_HEADINGS, *_BULLETS, *_CONTAINERS, *_SUBPAGES, *_SKIPPED, *_CAPTIONED, "paragraph", "numbered_list_item", "quote",
             "callout", "code", "equation", "table_row"}
    return next((key for key in known if isinstance(block.get(key), dict)), kind if isinstance(kind, str) else "")


def _text(kind: str, body: dict) -> str:
    if kind == "table_row":
        cells = [_plain(cell) for cell in body.get("cells") or [] if isinstance(cell, list)]
        return " | ".join(cells) if any(cells) else ""
    if kind == "equation":
        return str(body.get("expression") or "").strip()
    if kind in _CAPTIONED:
        return _plain(body.get("caption"))
    # Newer pages carry rich_text; the older API shape called it text.
    return _plain(body.get("rich_text") or body.get("text"))


_NOTES = {
    "time": "The rest of this Notion page wasn't imported because Notion was slow to answer.",
    "size": "The rest of this Notion page wasn't imported because the page is longer than Cordia reads at once.",
    "missed": "Part of this Notion page couldn't be read, so it isn't all here.",
}


@dataclass
class PageRead:
    """What a page read found. text is the page's lines, ending with a plain line that says so when
    a limit or a failed call kept part of the page out (partial); body is the lines alone."""
    body: str = ""
    partial: bool = False
    reason: str = ""            # "time", "size" or "missed" when partial
    sub_pages: list = field(default_factory=list)  # titles of sub-pages and databases, in order

    @property
    def note(self) -> str:
        return _NOTES.get(self.reason, "") if self.partial else ""

    @property
    def readable(self) -> bool:
        """A page that is only a short to-do ("- Gym") still counts; empty, dividers, images and a
        list of sub-pages do not."""
        return has_text(self.body)

    @property
    def text(self) -> str:
        return f"{self.body}\n\n{self.note}" if self.body and self.note else self.body

    def text_within(self, limit: int) -> tuple[str, bool]:
        """(text, partial) cut to `limit` characters at a line, the note kept as the last line."""
        text = self.text
        if len(text) <= limit:
            return text, self.partial
        note = _NOTES["size"]
        room = max(limit - len(note) - 2, 0)
        cut = self.body[:room]
        cut = cut[:cut.rfind("\n")] if "\n" in cut else cut
        return f"{cut}\n\n{note}", True


class _Reader:
    def __init__(self, fetch: Callable[[dict], dict], deadline: float, max_calls: int):
        self.fetch, self.deadline, self.max_calls = fetch, deadline, max_calls
        self.lock = threading.Lock()
        self.calls = self.blocks = 0
        self.kids: dict = {}      # id(block) -> the block's children, once read
        self.cut = ""             # why a limit stopped the read: "time" or "size"
        self.lost = False         # a call after the first failed
        self.lines: list = []
        self.written = 0          # lines that are the page's own text, not sub-page titles
        self.sub_pages: list = []

    # -- fetching, level by level --

    def _take(self) -> str:
        """"" and one call used, or the reason there is no room for another."""
        with self.lock:
            if time.monotonic() >= self.deadline:
                return "time"
            if self.calls >= self.max_calls or self.blocks >= MAX_BLOCKS:
                return "size"
            self.calls += 1
        return ""

    def _stop(self, reason: str) -> None:
        with self.lock:
            self.cut = self.cut or reason

    def _children(self, block_id: str, root: bool = False) -> list:
        """Every child of a block, page by page. A failure on the page's own first call is the
        caller's (a 502); a failure later keeps what was read, since part of a page beats none."""
        found: list = []
        cursor = None
        while True:
            reason = self._take()
            if reason:
                self._stop(reason)
                break
            arguments = {"block_id": block_id, "page_size": PAGE_SIZE}
            if cursor:
                arguments["start_cursor"] = cursor
            try:
                data = self.fetch(arguments)
            except HTTPException:
                if root and not found and not cursor:
                    raise
                self.lost = True
                break
            blocks, cursor = _listing(data)
            with self.lock:
                self.blocks += len(blocks)
            found.extend(blocks)
            if not cursor:
                break
        return found

    def _wait(self, futures: list) -> bool:
        """True when every call finished inside the budget; the stragglers are left behind."""
        wait(futures, timeout=max(self.deadline - time.monotonic(), 0))
        late = [future for future in futures if not future.done()]
        for future in late:
            future.cancel()
        if late:
            self._stop("time")
        return not late

    @staticmethod
    def _source(block: dict) -> str:
        """The id to ask Notion for a block's children: a synced copy keeps its content on the original."""
        kind = _kind(block)
        body = block.get(kind) if isinstance(block.get(kind), dict) else {}
        source = body.get("synced_from") if kind == "synced_block" else None
        block_id = (source.get("block_id") if isinstance(source, dict) else None) or block.get("id")
        return block_id if isinstance(block_id, str) else ""

    def load(self, page_id: str) -> list:
        pool = ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="notion-read")
        try:
            first = pool.submit(self._children, page_id, True)
            if not self._wait([first]):
                raise HTTPException(status_code=502, detail="The app didn't respond. Try again in a minute.")
            top = level = first.result()
            for depth in range(MAX_DEPTH + 1):
                inline, pending = [], []
                for block in level:
                    kind = _kind(block)
                    if block.get("archived") or block.get("in_trash") or kind in _SUBPAGES:
                        continue
                    if isinstance(block.get("children"), list):
                        inline.append(block)
                    elif block.get("has_children") is True and self._source(block):
                        pending.append(block)
                if not inline and not pending:
                    break
                if depth >= MAX_DEPTH:
                    self._stop("size")
                    break
                for block in inline:
                    self.kids[id(block)] = [item for item in block["children"] if isinstance(item, dict)]
                calls = [(block, pool.submit(self._children, self._source(block))) for block in pending]
                self._wait([future for _, future in calls])
                for block, future in calls:
                    if not future.done() or future.cancelled():
                        continue
                    if future.exception() is not None:
                        self.lost = True
                        continue
                    self.kids[id(block)] = future.result()
                level = [item for block in inline + pending for item in self.kids.get(id(block), [])]
                if self.cut:
                    break
            return top
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    # -- reading the tree --

    def read(self, blocks: list, indent: int) -> None:
        number = 0
        for block in blocks:
            if block.get("archived") or block.get("in_trash"):
                continue
            kind = _kind(block)
            body = block.get(kind) if isinstance(block.get(kind), dict) else {}
            number = number + 1 if kind == "numbered_list_item" else 0
            if kind in _SUBPAGES:
                title = str(body.get("title") or "").strip() or "Untitled"
                self.sub_pages.append(title)
                self.lines.append(f"{'  ' * indent}{_SUBPAGES[kind]}: {title}")
                continue
            if kind not in _SKIPPED and kind not in _CONTAINERS:
                text = _text(kind, body)
                if text:
                    mark = ("#" * _HEADINGS[kind] + " " if kind in _HEADINGS else "- " if kind in _BULLETS
                            else f"{number}. " if kind == "numbered_list_item" else "")
                    self.lines.append("  " * indent + mark + text)
                    self.written += 1
            inner = self.kids.get(id(block))
            if inner:
                self.read(inner, indent if kind in _CONTAINERS or kind in _HEADINGS else indent + 1)


def read_page(account: str, user_id: str, page_id: str, *, deadline: Optional[float] = None,
              max_calls: Optional[int] = None) -> PageRead:
    """The page's text as lines: "# heading", "- bullet or to-do", "1. step", plain paragraphs, with
    sub-items indented two spaces per level and sub-pages listed as "Sub-page: Title". `deadline` (a
    time.monotonic() value) and `max_calls` let a caller that has already spent some of its budget
    share what is left."""
    reader = _Reader(lambda arguments: composio.run(account, user_id, SLUG, arguments),
                     deadline if deadline is not None else time.monotonic() + TIME_BUDGET,
                     MAX_CALLS if max_calls is None else max_calls)
    reader.read(reader.load(page_id), 0)
    reason = reader.cut or ("missed" if reader.lost else "")
    if reason:
        log.warning("notion page cut short (%s): %d calls, %d blocks, %d lines read", reason, reader.calls, reader.blocks, len(reader.lines))
    return PageRead(body="\n".join(reader.lines) if reader.written else "", partial=bool(reason), reason=reason, sub_pages=reader.sub_pages)


def has_text(text: str) -> bool:
    """A page that is only a short to-do ("- Gym") still counts; empty, dividers and images do not."""
    return sum(char.isalnum() for char in text or "") >= 2
