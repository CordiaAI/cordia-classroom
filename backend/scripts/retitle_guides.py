"""Rename existing guides whose titles are file names or bare labels ("Chapter 7 PDF", "Nickels_UB2024_PPT_Ch01"),
the same way new guides are named when they're saved.

Lists the changes and writes nothing unless --apply is given. On Fly:
    fly ssh console -C "python scripts/retitle_guides.py"            # see the new names
    fly ssh console -C "python scripts/retitle_guides.py --apply"    # rename them
Options: --user <uuid> for one account, --limit N (default 500).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_supabase  # noqa: E402
from services.llm import guide_title  # noqa: E402
from services.text_processing import weak_title  # noqa: E402

# Guides the student named themselves (notes pages) keep their names.
SKIP_SOURCES = ("notes", "note:")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--user")
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()
    db = get_supabase()
    query = db.table("study_guides").select("id,user_id,title,notes,study_guide,source_type").order("created_at", desc=True).limit(args.limit)
    if args.user:
        query = query.eq("user_id", args.user)
    changed = 0
    for row in query.execute().data or []:
        old = row.get("title") or ""
        if str(row.get("source_type") or "").startswith(SKIP_SOURCES) or not weak_title(old):
            continue
        new = guide_title(old, row.get("notes") or row.get("study_guide") or "")
        if not new or new == old:
            continue
        changed += 1
        print(f"{old!r} -> {new!r}")
        if args.apply:
            db.table("study_guides").update({"title": new}).eq("id", row["id"]).eq("user_id", row["user_id"]).execute()
    print(f"{changed} guide{'s' if changed != 1 else ''} {'renamed' if args.apply else 'would be renamed (run with --apply)'}")


if __name__ == "__main__":
    main()
