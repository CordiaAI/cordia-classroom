# Chat-first redesign: the plan

Cordia Classroom becomes a chat-first app that looks and works like ChatGPT and Claude desktop. Classes work like projects and every study tool lives in the sidebar. The Tutor is the front door, but no feature is lost: every tool still opens on its own, with its current behaviour, data and limits.

How it looks: `DESIGN-SPEC.md` and the four mockups in `screens/`. How the run works: the `director` agent hands each task below to a `builder`, checks it, and runs the finish gate through a `gatekeeper`. Only passing work is merged into `redesign/chat-first`.

## Rules for every task

- Work on the task branch the director creates. Never push to `main`, merge into `main`, deploy, or apply a migration.
- Every colour, shadow, blur or gradient value lives in `tokens.css`, in light and dark.
- Every feature in the feature map at the bottom stays reachable from the place listed there.
- Backend changes are written and tested, but they are not live until Jude runs `fly deploy`. Frontend code that depends on a new backend field must still work, without errors, against the backend that is live now.
- New migrations are written with `NOT APPLIED: waiting for owner's OK` at the top. Any UI that needs one must still work before it is applied.
- No change to which AI models the product calls. No change to the extension's Canvas slideshow capture.
- Done means: acceptance criteria met, `scripts/redesign-gate.sh` exits 0, and the website-finish gate returns FINISHED with no High or Medium findings.

## Order

| Task | Depends on | Pages in scope for the gate | Motion |
| --- | --- | --- | --- |
| T0 Setup | none | none | no |
| T1 Glass v2 | T0 | Dashboard, Library, a guide page | yes |
| T2 App shell and sidebar | T1 | every page that shows the sidebar | yes |
| T3 Chat home | T2 | home | yes |
| T4 Composer and tool chips | T3 | home, class page | yes |
| T5 Saved chats | T4 | home, a chat | yes |
| T6 Tool pane | T5 | a chat with each pane open | yes |
| T7 Class page | T4 | a class page | yes |
| T8 Every tool inside the shell | T2 | every tool page | yes |
| T9 Phone layout | T6, T7, T8 | home, chat, class, Learn at 390px | yes |
| T10 Final sweep | T9 | every page above, light and dark | yes |

---

## T0 Setup

Goal: the integration branch, the kit and the gate script are in place.

1. Branch `redesign/chat-first` exists, created from `main`, and is pushed to `origin`.
2. `.claude/agents/`, `docs/redesign/` and `scripts/redesign-gate.sh` from the kit are committed on it.
3. `scripts/redesign-gate.sh` runs the same checks as `.github/workflows/release-checks.yml`, in the same order and from the same folders. If the workflow differs from the script, the script is changed to match the workflow.
4. `scripts/redesign-gate.sh` exits 0 on the branch before any redesign code is written. If it fails on untouched `main`, the director stops and tells Jude instead of starting T1.
5. `docs/redesign/STATUS.md` exists with every task set to `waiting`.

## T1 Glass v2

Goal: the glass from the mockups (DESIGN-SPEC section 2) replaces the current recipe everywhere, in both themes.

1. The tokens in DESIGN-SPEC section 2 exist in `tokens.css` with light and dark values.
2. The shared glass styles in the component bundle use them: sheen, grain, blur, the light-catching rim, and the layered shadow.
3. Primary buttons use olive glass. Selected items use selected glass. Hover and press follow DESIGN-SPEC section 6.
4. The app backdrop shows the cloud image as DESIGN-SPEC section 2 says (clearly visible in light, softened in dark).
5. With `prefers-reduced-transparency` the glass turns solid. With `prefers-reduced-motion` nothing lifts or scales.
6. Every text-on-glass pair keeps 4.5:1 contrast in both themes, measured over the cloud backdrop.
7. No raw colour values outside `tokens.css`; the existing colour-token test passes.

## T2 App shell and sidebar

Goal: the floating glass sidebar from DESIGN-SPEC section 3 replaces the current navigation on screens 768px and wider.

1. Top to bottom: the mark and "cordia" with the fold toggle; New chat (olive, 44px); Search with ⌘K / Ctrl K; Tools; Classes; Recent chats; the account row.
2. Tools lists Library, Learn, Flashcards, Quiz, Practice and Calendar. A "More tools" row opens a menu with every other tool in the feature map that is listed under "More tools".
3. Classes shows up to five pinned classes, sorted by course code, each with its colour dot and code, then "See all". A + button adds a class. A class with an exam in the next 14 days and a review set shows a readiness ring and % (DESIGN-SPEC section 3.3). A class without one shows nothing on the right.
4. Recent chats lists the newest chats that fit the remaining height. Until T5 lands, it lists the newest Tutor sessions that already exist.
5. Exactly one item is current (`aria-current="page"`). Folding the sidebar leaves 72px of icons with a tooltip and accessible name on each, remembered on the device. Between 768 and 1099px it is always folded.
6. The whole sidebar fits a 1440 × 900 window without scrolling. On shorter windows only the middle scrolls; New chat, Search and the account row stay put.
7. Keyboard: Tab reaches every item in order, ⌘K / Ctrl K opens Search, and the More tools menu works with the arrow keys and Escape.

## T3 Chat home

Goal: signed-in students land on the chat home from `screens/1-home.html`.

1. The signed-in landing route shows the home: the headline, the composer, the Up next list, and the one-line note under it.
2. The headline follows DESIGN-SPEC section 4.1: it names the soonest exam within 7 days that has a review set, with ideas left and today's pace, using the readiness and pacing math Learn already uses. With no such exam, it reads "What are you studying?" with no second line.
3. Up next shows at most three rows in one glass list, in this order when they exist: the soonest exam (ring, date, readiness, ideas left, "Start Learn"); flashcards due (count, classes, minutes, "Review"); the next Canvas deadline (title, class, due date and time, "Plan it"). Rows with nothing to show are left out. With nothing at all, the list is hidden.
4. The Dashboard keeps working at its current route and is listed under More tools.
5. First-week students still get the day-one walkthrough, started from the home.
6. The page loads whole, with the breathing mark if data takes over 200ms; no skeletons and no spinners.

## T4 Composer and tool chips

Goal: the composer from DESIGN-SPEC section 4.2 sends messages to the Tutor and lets a student pick a tool first.

1. The composer has, in order: the tool chips (Make guide, Learn, Flashcards, Quiz, Practice, Plan); the message box; and a bottom row with attach, voice, the class picker, and Send.
2. Choosing a chip marks it pressed (`aria-pressed`), changes the placeholder to that chip's prompt (DESIGN-SPEC section 4.2), and sends the matching Tutor skill or mode with the next message. Choosing it again turns it off. One chip at a time.
3. Attach accepts everything the New sheet accepts today (up to 5 files, the same types and limits), and paste and link work in the message box. Make guide plus files builds a guide exactly as the New sheet does.
4. The class picker defaults to "All classes" on the home and to the current class on a class page, and scopes the Tutor's material.
5. Send is quiet until there is text or a file, then turns olive. Enter sends, Shift+Enter makes a new line, and the box grows to 8 lines then scrolls.
6. Plan limits still apply: a 402 `limit_reached` opens the upgrade modal and keeps what the student typed.
7. The New button and New sheet keep working wherever they are reachable today.

## T5 Saved chats

Goal: Tutor conversations become chats with their own URL, listed in Recent chats.

1. Every conversation started from a composer becomes a chat at `/chat/[id]`. Reloading the page restores it.
2. A chat's title comes from its first message until the student renames it. The chat ⋯ menu offers Rename, Move to class and Delete (with Undo in a toast).
3. Recent chats in the sidebar and the Chats tab on a class page read from the same data. A chat moved to a class shows on that class page.
4. Existing Tutor history (per guide and general) appears in the chat list; nothing is lost.
5. If a new column or table is needed, its migration is written and marked NOT APPLIED, and the UI falls back without errors until it is applied.
6. Session state is still shared with the Chrome extension's Tutor.

## T6 Tool pane

Goal: when the Tutor starts a tool, the real tool opens beside the chat, as in `screens/2-chat-with-tool-pane.html`.

1. The Tutor reply can carry an action that opens a pane: Practice, Learn, Flashcards, Quiz, a guide's Outline, or Plan my week, each with the guide or set it applies to. Extend the Tutor's existing "open places in the app" ability; don't add a second mechanism.
2. The reply shows a tool card (DESIGN-SPEC section 4.3) that opens or focuses the pane. The pane opens on its own the first time.
3. The pane hosts the real tool components with their current behaviour, saving, limits and grading. Nothing is a copy or a simplified version.
4. The pane header shows the tool, the set and class, progress where the tool has it, open full screen (goes to the tool's own page with the same state), and close.
5. The chat and the pane share the window from 1100px up (chat at least 400px, pane at least 520px, divider draggable with a keyboard alternative). Narrower than 1100px, the pane opens over the chat with a back button.
6. Motion follows DESIGN-SPEC section 6.2, including reduced motion.
7. The backend change is covered by unit tests. The frontend works, without errors, against the backend that is live now: when no action comes back, the reply shows as plain text.

## T7 Class page

Goal: a class page works like a project, as in `screens/3-class-page.html`.

1. The header shows the class cover, the class name as the page title, the course code and the Canvas sync time, the sharing control (Private / Share with {code}, as today), and a ⋯ menu.
2. A composer scoped to the class sits under the header; chats started there belong to the class.
3. Tabs: Chats, Guides (with count), Files, Deadlines, Grades. Files and Grades show only for Canvas classes. Class sets stay reachable from the Guides tab.
4. Each guide row shows its source, idea count, a mastery bar (mastered, familiar, learning, new) with "N of M mastered", Learn, and a ⋯ menu with every action the guide has today. A review set built for an exam leads the list with its readiness ring.
5. The exam card (right column, or below on narrow screens) shows the next exam, its date and time, the readiness ring and %, ideas left and the daily pace, "Start today's N" (opens Learn on the review set with the test date filled in) and "Timed practice test". With no upcoming exam it shows "Build review set" when the class has guides, and is hidden otherwise.
6. Due soon lists the next deadlines and the current grade estimate, worded as an estimate.

## T8 Every tool inside the shell

Goal: every tool page opens inside the new shell, and every feature in the feature map is reachable from its listed place.

1. Learn, Flashcards, Quiz, Practice, NCLEX, Study now, Library, Calendar, Plan my week, Progress, Record lecture, Write cards and Import, Notes, the Assistant settings and Settings all open inside the shell.
2. The study screens that use focus mode today (Learn, Flashcards, Quiz, NCLEX, Practice, Study now) open with the sidebar folded to icons, and a button brings it back. They stay usable with the keyboard alone.
3. Learn matches `screens/4-learn-in-shell.html`: the back link to the set, the round progress, the card, and "Ask the Tutor about this", which opens a chat with the question attached.
4. A gatekeeper walk through the feature map finds every item at its listed place.

## T9 Phone layout

Goal: the redesign works on phones.

1. Under 768px: the top bar and a bottom tab bar (Home, Library, New chat in the middle, Calendar, Classes). The sidebar becomes a drawer from the top bar's menu button, with the same sections.
2. The composer sits at the bottom above the tab bar and keeps its chips in one row that scrolls sideways inside itself; the page never scrolls sideways.
3. Tool panes open full screen with a back button. Swipe cards and tap-to-match keep working.
4. Every tap target is at least 44px. Checked at 390 × 844.

## T10 Final sweep

Goal: the whole redesign is finished in both themes.

1. Every page in this plan passes the gate in light and dark.
2. Empty states exist for: no classes, no guides, no chats, no deadlines, no exams, Canvas not connected.
3. Navigation code that nothing uses any more is removed, with every import and route checked.
4. Keyboard and screen reader pass: skip link, landmarks, one h1 per page, labelled icon buttons, a visible focus ring everywhere.

---

## Feature map: where every feature lives after the redesign

| Feature today | Where it lives |
| --- | --- |
| New sheet: Upload, Paste, Link, Record, Try a sample, class picker | Composer (attach, paste, link, voice) with the Make guide chip; New sheet still opens from More tools › New |
| Write cards / Import from Quizlet (`/create`) | More tools › Write cards; guide ⋯ › Edit |
| Notes, Make it an outline, Make flashcards and quiz | Library; guide page |
| Lectures, Add notes, Record lecture | More tools › Record lecture; Library › Lectures |
| Guide page: Outline, By page, Learn, Flashcards, Quiz, Practice, NCLEX tabs | Unchanged, inside the shell; also as panes from chat |
| Highlight menu: Visualize, Explain, Make card, Ask | Unchanged on guide pages; Ask opens a chat |
| Learn | Tools › Learn; chip; pane; class exam card |
| Flashcards | Tools › Flashcards; chip; pane |
| Quiz, Match, Check yourself | Tools › Quiz; chip; pane |
| Practice (drawing board, Tidy, Check answer) | Tools › Practice; chip; pane |
| NCLEX | More tools › NCLEX (shown when nursing material exists); guide tab |
| Study now / Daily review | Home Up next › Review; More tools › Study now |
| Dashboard (Continue, Class updates, Course work) | More tools › Dashboard; Home Up next |
| Calendar | Tools › Calendar |
| Plan my week (`/week`) | More tools › Plan my week; Plan chip |
| Assignment sheet (Break it down, Schedule, rubric, Doc feedback, GitHub) | Class page › Deadlines; Home Up next › Plan it |
| Grades | Class page › Grades |
| Canvas page (Sync now, files, choose classes) | Class page › Files; Settings › Canvas |
| Progress (streaks, charts, heatmap, knowledge map, insights, recap) | More tools › Progress |
| Classes, covers, sharing, class sets | Sidebar › Classes; class page |
| Tutor (`/tutor`, drawer, chips, modes, learning style, past chats) | The chat itself; modes in Settings › Tutor; past chats in Recent chats |
| Connectors | Settings › Connectors |
| Cordia Assistant settings (`/assistant`) | More tools › Assistant |
| Settings, Help, Send feedback, theme, Sign out | Account row menu |
| Upgrade, plan limits | Account row menu; upgrade modal on any `limit_reached` |
| Chrome extension | Unchanged |
