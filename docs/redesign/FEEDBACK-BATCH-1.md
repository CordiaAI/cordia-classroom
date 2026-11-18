# Feedback batch 1 (F1 to F9), from Jude on 2026-11-18

Queued after T10's UI and T5 (both halves). Lean mode: two builders at once, short cards, self-check, website-finish in fix mode for anything visual, work-in-progress commits. Branches from `origin/main` (the MVP is merged). Each pull request lists its feedback ids in its description and gets its Vercel preview link. When a pull request merges, Jude gets one SQL statement to mark its ids resolved (the director never runs it):

```sql
update public.feedback set status = 'resolved' where left(id::text, 8) in ('<id>', '<id>');
```

## Pull requests (grouped by area) and order

| Order | Pull request | Tasks | Model | Feedback ids | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Tutor as a study helper | F6 | Opus | f53bfc5f | Highest of the batch. Prompts stay domain-neutral; no change to which models the product calls. Backend parts need `fly deploy` by Jude. |
| 2 | Learn question quality | F5 | Opus | ed2eb2e2, b67047f0 | Find why structure questions slipped through; fix in `text_processing.py` first, prompts second (CLAUDE.md). Test on nursing, art history, business law, literature, CS. Backend: `fly deploy` by Jude. |
| 2b | Calendar with four views | F10 | Opus (UI), Sonnet (data and wiring) | none given | After F6 and F5. Mockups: redesign canvas https://claude.ai/artifact/T1sk4u66DGSsnWDR26swbh, boards Calendar A to D. Existing data only; a needed table gets a NOT APPLIED migration. Own pull request with a preview. |
| 3 | Settings polish | F1 | Sonnet | 4f036165 | Includes the Notion import fixes (ordinary pages import their text). |
| 4 | Guide page | F4 | Sonnet | 5ec17e97, 298f5965, b24fe320 | |
| 5 | Search and the tour | F2, F7 | Opus (F2), Sonnet (F7) | ee529baf, 8844cc2f | Starts after T10 merges: T10 edits `SearchModal.js`. |
| 6 | Discover | F8 | Sonnet | da3d2e78 | |
| 7 | Class page | F3 | Sonnet (Opus if the move bug is not obvious) | 94d2c434, ed985ffa, c68fdc60 | The move/delete bug can be found and fixed first; the menu and chip work goes on T7's rebuilt class page, so it runs after T7, or folds into T7's card if T7 restarts first. |
| - | Old feedback triage | F9 | Haiku checks, Sonnet fixes | 248ebf12, cea46902, 484b0bb5, 79ab943f, 2fe8c704, 15de8b23, 82ab27ba, f4c8df2f, 271a6698, 8a439d80, 3cf827e0, 1160ce62, 794b38ff, 4d71d4d6, 8d33de8f, 504b122b, 4634db25 | Runs first in a free slot (read-only, cheap): each id checked against `main`; anything still broken folds into the matching pull request above; already fixed ones go in Jude's SQL with the first merge. 62545b1f and 7e1828ac are junk (Jude): mark them resolved too, or delete, Jude's call. Needs each item's text: a read-only select on `public.feedback` (no write). |

After the batch: T7, then T6, T8, T9, T11 as before.

## Task text (Jude's words)

F6 Tutor as a study helper [f53bfc5f]: when a student says they need to study for a test, the Tutor plans instead of lecturing. It finds the matching guide (or offers to build one from their material or Canvas), sets the test date in Learn, starts with a short check-in quiz in Learn via a button, and when they finish it comes back to the Tutor with what to do next and when, based on the due date. "Make a Learn for it" (or similar) builds the set and opens Learn, using the existing build_guide and practice skills. Grounding: with no material selected, never state specific facts (names, numbers, dates) as fact; offer to pull in their material, or say plainly that it's unsure (the "six Confederate veterans" answer about ATO's founders was wrong; there were three founders). Tone: no slang openers like "Yo"; warm, plain, brief.

F5 Learn question quality [ed2eb2e2, b67047f0]: no questions about the document's structure ("listed for Chapter 1", "Slide 5"); questions about the subject that stand alone, as the generation prompt already requires; find why this slipped through. Wrong answer choices the same kind and length as the right one and plausible (never "Hyundai"), always 4 choices. Help me remember tricks map onto each part of the actual answer (a list of names: every name gets a hook). Domain-neutral; test on nursing, art history, business law, literature and CS.

F2 Search palette [ee529baf]: Apple-style liquid glass; a glass search pill and results in a separate glass bubble 8px below; no green focus outline (the normal focus ring); remove duplicate results.

F1 Settings polish [4f036165 + Jude's screenshot]: inner padding on every Settings card; toggles as setting rows (label and description left, switch right); "Remove my 18+ confirmation" as a quiet button with padding; memory rows aligned with their icon and remove button; "Clear all" as a quiet destructive action; Import from Notion: fix the overlapping dropdown and search field and the icon outside the field, show "no readable text" only after an import attempt fails, and make ordinary Notion pages (to-do lists, text pages) import their text.

F3 Class page [94d2c434, ed985ffa, c68fdc60]: every card and row gets the ⋯ menu top right (visible on hover and focus, always on touch); fix the empty-circle icon; "Yours" a padded, vertically centred chip; find and fix why moving a guide or set to another class, or deleting it, often doesn't take, with a test that proves it.

F4 Guide page [5ec17e97, 298f5965, b24fe320]: edit pencil vertically centred on the title's first line with a 12px gap, as a quiet icon button. Print quiz: + disables at the maximum the guide can supply, and the max shows. Short answer and matching written by AI when the guide lacks ready pairs, like Quiz does, counted as one AI quiz.

F7 Onboarding tour [8844cc2f]: the highlight cut-out uses the target's own border-radius plus padding everywhere (a pill gets a pill); Skip never overlaps the Tutor button.

F8 Discover [da3d2e78]: proper empty state with padding, and something useful on an empty page (popular public sets or classmates' class sets), in the shell's layout.

F9 Old feedback triage: see the table. 79ab943f: practice graded "54" wrong when the answer was 54.

F10 Calendar, four views (Jude, 2026-11-18), from the redesign canvas boards Calendar A to D. One segmented control: Week, Board, Month, Agenda; remember the last one on the device. Defaults: Week on wide screens, Agenda under 768px (Agenda is the only phone view until T9).
- Week (board A): time grid 8 AM to 10 PM, a Due strip above each day, study blocks as class-tinted glass, exams as solid olive blocks, today's column tinted, an olive now line. Drag a study block to move or resize it.
- Board (board D): seven day columns with cards in time order, planned study hours per day as a small bar, the exam card with its readiness ring, "Add study time" per day, and a "Needs a time" tray at the top. Drag a tray item onto a day to make a study block, or press Find time.
- Month (board C): month grid with up to two deadline chips per day plus "+N more", study counts, today outlined, the selected day's timeline in a right panel. Click a day to select it.
- Agenda (board B): Yesterday, Today, Tomorrow and later as a list with one action per row (Start for study time, Review now for an exam, Find time if nothing is planned, Planned if it is), with exam readiness, a mini month and "Needs study time" on the right.
Shared: Plan my week in the header; the same class colours and flag icon for anything due; done items struck through and faded; the exam readiness ring from Learn's real numbers. "Needs study time" = a deadline in the next 7 days with no study block for that class before it. Find time uses the existing Plan my week logic. Moving or creating study blocks keeps the existing Google Calendar sync. Data from existing sources only (Canvas deadlines, lecture to-dos, study_blocks, assignment steps); no new tables, or a NOT APPLIED migration for Jude.
Director's note: the canvas is a claude.ai artifact; earlier sessions could not open such links from here. When F10 starts, the director tries the built-in browser (Jude may already be signed in) and saves the four boards as images into the F10 worktree for the builders; if that fails, Jude is asked to export them.
