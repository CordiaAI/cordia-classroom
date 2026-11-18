"""A Notion page's text, for Settings > Connectors imports and the Tutor.

Notion hands a page back as a tree of blocks: the page's own children first, then each block's
children through another call (a toggle's contents, a bullet's sub-bullets, a column, a table's rows).
Every text-bearing block type is read, long pages are read page by page, and nested children are
followed, with a cap on depth, calls and blocks so one page can't run away. Composio returns the
list as Notion does ({"results": [...]}) or wrapped one level down ({"block_child_data": {...}}); both
are read. The tree is read-only: nothing here writes to Notion.
"""

from typing import Callable, Optional

from fastapi import HTTPException

from services import composio

MAX_DEPTH = 4       # levels of children below the page that are followed
MAX_CALLS = 40      # Notion calls for one page, including the first
MAX_BLOCKS = 800    # blocks read for one page
PAGE_SIZE = 100
SLUG = "NOTION_FETCH_BLOCK_CONTENTS"

# Response keys that hold the list of blocks, and the keys a response can be wrapped in.
_LISTS = ("results", "blocks", "children", "items")
_WRAPPERS = ("block_child_data", "data", "response", "result")

_HEADINGS = {"heading_1": 1, "heading_2": 2, "heading_3": 3, "heading_4": 4}
_BULLETS = {"bulleted_list_item", "to_do", "toggle"}
# Blocks that only hold other blocks (or are pointers/dividers): they add no line of their own and
# their children sit at the same indent. Child pages are separate pages and are not read into this one.
_CONTAINERS = {"column_list", "column", "synced_block", "template", "table"}
_SKIPPED = {"child_page", "child_database", "link_to_page", "divider", "breadcrumb", "table_of_contents", "unsupported"}
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
    known = {*_HEADINGS, *_BULLETS, *_CONTAINERS, *_SKIPPED, *_CAPTIONED, "paragraph", "numbered_list_item", "quote",
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


class _Reader:
    def __init__(self, fetch: Callable[[dict], dict]):
        self.fetch, self.calls, self.blocks, self.lines = fetch, 0, 0, []

    def full(self) -> bool:
        return self.blocks >= MAX_BLOCKS

    def children(self, block_id: str) -> list:
        """Every child of a block, page by page. A failure on the very first call is the caller's
        (a 502); a failure later keeps what was read, since part of a page beats none of it."""
        found: list = []
        cursor = None
        while self.calls < MAX_CALLS and self.blocks + len(found) < MAX_BLOCKS:
            self.calls += 1
            arguments = {"block_id": block_id, "page_size": PAGE_SIZE}
            if cursor:
                arguments["start_cursor"] = cursor
            try:
                data = self.fetch(arguments)
            except HTTPException:
                if self.calls == 1:
                    raise
                break
            blocks, cursor = _listing(data)
            found.extend(blocks)
            if not cursor:
                break
        return found

    def read(self, blocks: list, depth: int, indent: int) -> None:
        number = 0
        for block in blocks:
            if self.full():
                return
            self.blocks += 1
            if block.get("archived") or block.get("in_trash"):
                continue
            kind = _kind(block)
            body = block.get(kind) if isinstance(block.get(kind), dict) else {}
            number = number + 1 if kind == "numbered_list_item" else 0
            if kind not in _SKIPPED and kind not in _CONTAINERS:
                text = _text(kind, body)
                if text:
                    mark = ("#" * _HEADINGS[kind] + " " if kind in _HEADINGS else "- " if kind in _BULLETS
                            else f"{number}. " if kind == "numbered_list_item" else "")
                    self.lines.append("  " * indent + mark + text)
            if kind in {"child_page", "child_database"} or depth >= MAX_DEPTH:
                continue
            inner = block.get("children")
            if not isinstance(inner, list):
                # A synced copy keeps its content on the original block.
                source = body.get("synced_from") if kind == "synced_block" else None
                block_id = (source.get("block_id") if isinstance(source, dict) else None) or block.get("id")
                inner = self.children(block_id) if block.get("has_children") is True and isinstance(block_id, str) and block_id else []
            if inner:
                self.read([item for item in inner if isinstance(item, dict)], depth + 1,
                          indent if kind in _CONTAINERS or kind in _HEADINGS else indent + 1)


def page_text(account: str, user_id: str, page_id: str) -> str:
    """The page's text as lines: "# heading", "- bullet or to-do", "1. step", plain paragraphs, with
    sub-items indented two spaces per level. "" when the page holds no text."""
    reader = _Reader(lambda arguments: composio.run(account, user_id, SLUG, arguments))
    reader.read(reader.children(page_id), 0, 0)
    return "\n".join(reader.lines)


def has_text(text: str) -> bool:
    """A page that is only a short to-do ("- Gym") still counts; empty, dividers and images do not."""
    return sum(char.isalnum() for char in text or "") >= 2
