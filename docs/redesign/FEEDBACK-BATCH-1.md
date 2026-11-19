# Feedback batch 1 (F1 to F9), from Jude on 2026-11-18

Queued after T10's UI and T5 (both halves). Lean mode: two builders at once, short cards, self-check, website-finish in fix mode for anything visual, work-in-progress commits. Branches from `origin/main` (the MVP is merged). Each pull request lists its feedback ids in its description and gets its Vercel preview link. When a pull request merges, Jude gets one SQL statement to mark its ids resolved (the director never runs it):

```sql
update public.feedback set status = 'resolved' where left(id::text, 8) in ('<id>', '<id>');
```

## Pull requests (grouped by area) and order

| Order | Pull request | Tasks | Model | Feedback ids | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Tutor as a study helper | F6 | Opus | f53bfc5f | Highest of the batch. Prompts stay domain-neutral; no change to which models the product calls. Backend parts need `fly deploy` by Jude. |
| 1a | Tutor thinking lines | T4b | Sonnet | none given | Right before F11 (F11 uses it); after F6, since both touch the Tutor request path (`backend/routers/chat.py`, `useTutorChat.js`). Own pull request with a preview. Backend part needs `fly deploy`. |
| 1b | Tutor voice mode | F11 | Opus (voice UI, turn-taking), Sonnet (backend endpoint) | none given | Right after F6 (builds on F6's Tutor). Own pull request with a preview. New `POST /tutor/speak` (ElevenLabs, Fly secret `ELEVENLABS_API_KEY`, already staged by Jude), new `voice_characters` limit. Needs `fly deploy` after merge; Jude gets the exact steps. |
| 2 | Learn question quality | F5 | Opus | ed2eb2e2, b67047f0 | Find why structure questions slipped through; fix in `text_processing.py` first, prompts second (CLAUDE.md). Test on nursing, art history, business law, literature, CS. Backend: `fly deploy` by Jude. |
| 2b | Calendar with four views | F10 | Opus (UI), Sonnet (data and wiring) | none given | After F6 and F5. Mockups: `screens/calendar-a-week.png`, `calendar-b-agenda.png`, `calendar-c-month.png`, `calendar-d-board.png` (canvas boards Calendar A to D); visual reference, the written spec wins where they differ. Existing data only; a needed table gets a NOT APPLIED migration. Own pull request with a preview. |
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
Mockups (exported by Jude): `docs/redesign/screens/calendar-a-week.png` (Week), `calendar-b-agenda.png` (Agenda), `calendar-c-month.png` (Month), `calendar-d-board.png` (Board). Visual reference only; the written spec wins where they differ.

F11 Tutor voice mode (Jude, 2026-11-18), queued right after F6. A hands-free conversation with the Tutor, like Claude's voice mode: a full-screen voice view with the breathing Cordia mark, live captions of both sides, tap anywhere (or Space) to interrupt, and End returns to the chat with the whole exchange saved as normal messages. The thinking lines from T4b show while the Tutor works.
Pipeline:
1. Listening: record the turn with voice-activity detection (stop after about 800ms of silence); transcribe with the existing Whisper path (Groq); fall back to the browser's speech recognition if that is unavailable.
2. Thinking: the normal Tutor endpoint with the same context, skills and limits, streaming as now, plus a voice flag so replies are written to be heard: short sentences, no markdown, tables or lists read naturally, no URLs or code read out ("I've put that in the chat").
3. Speaking: speak each sentence as soon as it is complete (speech within about a second). Free: the browser's speechSynthesis (best English voice), no network cost. Pro and trial: ElevenLabs through a new `POST /tutor/speak` that streams audio; key is the Fly secret `ELEVENLABS_API_KEY`, never sent to the browser, never logged; ElevenLabs' low-latency model, one calm default voice, and a picker of 3 or 4 voices in Settings › Tutor.
4. Interrupting: if the student talks or taps while the Tutor speaks, stop the audio at once and listen.
Limits and cost: a `voice_characters` monthly limit (Pro 150,000, Free 0 for ElevenLabs) with the existing require() and record() pattern; usage to `usage_events` as feature `tutor_voice`; a Pro student at the limit falls back to the browser voice with a one-line note. Cache nothing that contains student content.
Rules: microphone only after the student starts voice mode, with a clear on-screen indicator while listening; keyboard and screen readers; reduced motion; a blocked microphone gets instructions to allow it; a one-line privacy note that voice audio is transcribed and not stored.
Director's notes: the AI models the Tutor calls stay as they are (CLAUDE.md); ElevenLabs is a text-to-speech vendor Jude chose, not a model change. F11 uses T4b's thinking lines (T4b now runs right before F11). Ready = merged-ready pull request plus Jude's exact steps (confirm the Fly secret, `fly deploy` from a `main` checkout, `fly logs`, privacy policy line).

T4b Tutor thinking lines (Jude, 2026-11-18), right before F11; Sonnet; own pull request. Replaces the static "Explaining material…" loading state in the Tutor and chat.
Look: one breathing Cordia mark (the app's only loading indicator) plus one status line in the Tutor's text style with a shimmer, no second icon. The line cross-fades to the next every 2.2 seconds and disappears the moment the first answer text streams in. Reduced motion: no shimmer, lines swap without a fade. `aria-live="polite"` announces only the first line.
Lines, in priority order:
1. Real steps, shown the moment they happen, only if really happening: "Reading <guide or file title>", "Searching your <class code> material for <topic>", "Checking Canvas for <what>", "Drawing a diagram", "Building your study guide".
2. Thinking lines about the question: when the Tutor request starts, a parallel Claude Haiku call (the light tier, low effort, max 80 output tokens) with the student's message and the class or guide name, returning JSON with 3 or 4 lines. Prompt rules: each line 3 to 7 words, sentence case, starts with an -ing verb, specific to the question's topic ("Tracing the Krebs cycle step by step"), first person only when the question is about Cordia itself ("Thinking about what I can help with"), never claims an action (no searching, checking or reading), no exclamation marks, no emoji, no ellipsis. Domain-neutral: nursing, art history, law, literature, CS.
3. Until the Haiku lines arrive (or if that call fails or is slow): "Reading your question".
The Haiku call does not count toward the student's monthly limits, is logged to `usage_events` as feature `tutor_status`, and never delays or blocks the real answer; if the answer starts first, the lines are never shown.
In voice mode (F11): the same lines as captions while the Tutor thinks, never spoken.
Director's note: Haiku is already the product's light tier (CLAUDE.md), so this adds a call on an existing model, not a model change.

F6b Tutor tools and grounding redesign (Jude, 2026-11-18), Opus, queued after F11.
1. Building a Learn set: drop the phrase matching. Expose the existing build_guide and practice skills to the Tutor model as tools and let it decide when the student is asking for one. A tool call that would build a guide must confirm in one line ("Making a Learn set on heart failure, digoxin and diuretics. Starting now.") so nothing is ever built silently. Test with the 31 natural commands from the last review (scratchpad rook-f6d/fresh_learn.py) plus 25 ordinary questions that must not build anything.
2. The "unchecked" line: drop the word patterns. When no material is selected, run a Claude Haiku check (light tier, low effort) on the finished answer that returns only the specific claims (names, numbers, dates, quotes) not supported by the student's selected material, and show the line only if there are any. Test across nursing, art history, law, literature and CS, including two-letter names and answers starting with "Usually" or "Tell".
Log both to usage_events; neither counts toward the student's limits. Haiku is the product's existing light tier (CLAUDE.md), so no new model.

H1 Home headline by class (Jude, 2026-11-19). Sonnet, web only, right after the dictation fix (#286). Draft, review, director-review, then ready to merge.
The home headline (and the line under it) changes with the class picker, Claude-style, instead of always "What are you studying?".
- All classes: a greeting with the student's first name from their profile (no name if none). One per day from: "Good morning, <name>" (5 to 11:59 AM), "Good afternoon, <name>" (noon to 4:59 PM), "Good evening, <name>" (5 to 10:59 PM), "Up late, <name>?" (11 PM to 4:59 AM), "What's on your mind, <name>?", "Ready when you are, <name>". Time-of-day ones chosen twice as often.
- A class picked, first match wins: (1) an exam in that class within 7 days with a review set: the current exam headline and pace line; (2) a deadline in that class within 3 days: "<Assignment name> for <course code> is due <weekday>." with "Due <weekday> at <time>" under it; (3) a weak idea in that class from Learn (Learning level, missed recently): "Want another look at <topic>?" with "<readiness>% ready in <course code>" under it, using the guide's topic name, never a raw question; (4) otherwise one of "What's next in <class name>?", "Picking up <class name>?", "Where were we in <class name>?", "Let's work on <class name>", no line under it.
- Deterministic per student, class and calendar day (seeded), so it changes only when the class or day changes. Built from data already loaded for the home: no extra AI call or round trip. Sentence case, no exclamation marks, no emoji, no guilt or streak pressure, assignment names shortened to about 40 characters. 150ms crossfade on class change; instant with reduced motion. Works in the phone layout. Tests for each branch and for same-day stability.
Director's note: builds on #286's home text helpers (plan title and class cleaning); branch from main after #286 merges, or from #286's branch if it hasn't.
