# Social and sharing: Stage 0 audit

Read-only audit for the Quizlet-style social and sharing plan (Stages 1–10). It was written on
2026-11-05 against `main` at `456e606`. Paths are relative to the repo root, and line ranges are as
of that commit.

The live database baseline is `supabase/schema/live-2026-11.sql`, read from production by the owner
on 2026-11-05 (header at `:1-8`). `study_guides`, `folders`, `user_profiles`, `user_streaks`,
`study_sessions` and `quiz_attempts` have no `create table` in `supabase/migrations/`; the snapshot
is their only definition (`supabase/schema/README.md:65-68`).

**What this changes in the plan, in short** (details in [§9](#9-what-this-changes-in-later-stages)):
- Class sets are **copies, not live guides**. Saving a set creates a new guide owned by the
  studier, and the snapshot is overwritten in place, so no history is kept. Stage 3/4's "one guide,
  progress per viewer" is a new model. Existing copies need a mapping.
- **No idea has a stable ID.** Progress is keyed by array position in two different arrays. Stage 4
  must add `idea_id` first, and it should be the same ID as the personalization plan's
  `item_memory.item_id`.
- **The browser can still write `study_guides` and `folders` directly** (live RLS drift). This
  breaks "client write policies stay deny-all" today. Fix it before Stage 3 exposes other people's
  guides.
- `user_profiles` holds `email`. A row-level "public profiles are readable" policy would expose
  emails. Serve profiles only through the API.
- Daily rate limits ("100 follows/day") can't use today's limiter, which counts in memory per
  machine. They need a database counter.
- "Verified instructor" today means "confirmed email at the school's domain". No code ever writes
  the domains, so the check is weak and usually fails.

---

## 1. What `class_memberships` represents, and who can create classes

**A row means "this user says they take this course this term".** Nothing proves enrollment.
- Schema: PK `(user_id, class_term_id)` and `source in ('canvas','calendar','manual')`
  (`supabase/migrations/20261015120000_canvas_classes.sql:83-90`; live `live-2026-11.sql:204-215`).
- Membership checks ignore the term. `user_class_ids` collapses all terms to class IDs, and
  `is_member` checks against that list (`backend/services/class_db.py:101-110`).
- RLS: a student reads only their own rows. The comment says "never a roster"
  (`20261015120000_canvas_classes.sql:120-138`). The SQL helper `is_class_member()` is at `:106-118`.

**Writers.** Everything goes through `add_membership` (`backend/services/class_db.py:67-74`), which
also find-or-creates the term and the Library folder. Its three callers:
1. **Manual:** `POST /classes` → `add_class` (`backend/routers/classes.py:127-151`), source
   `manual` (`:150`). It checks only that the caller is signed in.
2. **Canvas:** `_import_course` (`backend/routers/canvas.py:127-144`), from `sync()`
   (`:362-398`) and `PUT /canvas/courses/{id}` (`:553-578`).
3. **Calendar feed:** `connect_calendar` → `_import_classes` (`backend/routers/calendar.py:415-458`).
   Course codes are parsed from event titles, at most 20.

**Removal.**
- `remove_membership` (`class_db.py:113-116`) runs only from `DELETE /classes/{id}`
  (`classes.py:154-158`). The web calls it when a class folder is deleted (`web/pages/library.js:218`,
  `web/pages/folder/[id].js:141-142`).
- Disconnecting Canvas or un-importing a course leaves memberships in place (`canvas.py:103-107`,
  `:561-564`, `:625-633`).
- Leaving a class does not unshare that user's sets in that class.
- An admin merge moves memberships to the target class (`backend/routers/admin.py:99-121`).

**Who can create courses.**
- **Any signed-in user** can create a `classes` row: `ensure_class` (`class_db.py:31-59`) is reached
  from `POST /classes` (`classes.py:141`), Canvas, Calendar, and the instructor opt-out form
  (`backend/routers/public_forms.py:76`).
- The same is true for a `schools` row: `ensure_school` (`class_db.py:16-28`) is reached from
  `POST /classes` with a free-text `school_name` (`classes.py:135-136`), Canvas and Calendar.
- New classes queue `class_merge_proposals` for near-duplicate codes (`class_db.py:51-58`;
  `backend/services/class_catalog.py:37-47`). An admin reviews them (`admin.py:71-73`, `:99-121`).
- **Consequence:** anyone who knows a school and a course code can join that course and read its
  visible class sets. No other gate exists.

**"Verified instructor" check.** It exists only in `backend/routers/public_forms.py`:
- `_verified_email` (`:34-41`) needs a Supabase-confirmed email.
- `_school_email_domains` (`:21-26`) and `_email_matches` (`:29-31`) need that email to match
  `schools.email_domains`, or a domain derived from a non-`instructure.com` Canvas host.
- **There is no instructor role.** A student with a school email passes the same check.
- **No code writes `schools.email_domains`.** Its only readers are `public_forms.py:22` and
  `backend/services/mail_watch.py:44-51`. Schools on `*.instructure.com`, or created by name, get no
  domains, so the check returns 403 (`:71-73`). Whether any live rows have domains is unverified.

---

## 2. Do Q/A ideas have stable IDs?

**No.** Q/A pairs live in three places, each with its own index space.

| Store | Shape | Built by |
| --- | --- | --- |
| `study_guides.study_guide` (text) | `Q1:` / `A1:` lines, renumbered on every generation | `backend/services/llm.py:174-259` |
| `study_guides.flashcards` (jsonb array) | `[{front, back, image?}]` | `study_guide_to_flashcards` (`llm.py:714-731`) drops duplicate pairs. Cards are also appended by hand (`web/pages/guide/[id].js:349-357`), by Make study set (`web/lib/autoStudySet.js:20-22`) and by MCP `mcp_add_flashcards` (`supabase/migrations/20261102120000_mcp_write_tools.sql:316-371`) |
| `study_guides.quiz_questions` (jsonb array) | `[{question, options, correct_index}]` | First 50 parsed pairs (`backend/routers/quiz.py:243-247`). Pairs with no distractors are skipped (`:166-167`, `:315-316`). Cached at `:203-212` |

Because of deduplication, skipped pairs, the 50-question cap and appended cards, **card index `i`
and quiz index `i` can point at different ideas even before anyone edits anything.**

**How an idea is identified, by consumer:**

| Identity | Used by |
| --- | --- |
| Position in `flashcards` | `flashcard_progress.schedule/known/unknown`; MCP `card_id = '<guide>:card:<i>'` (`web/lib/mcp/readTools.mjs:119`); Study now card items (`web/lib/studyQueue.mjs:58-66`) |
| Position in `quiz_questions` | `flashcard_progress.learn.levels` (`web/lib/studyQueue.mjs:5-7` says "Ideas are the guide's quiz_questions, by index"); Retain `concept` (`quiz.py:36-43`); `quiz_attempts.answers[].question_index` (`quiz.py:498-503`); MCP `question_id` (`readTools.mjs:127, 248-252`) |
| 48-char fingerprint `q` | Validity check on Learn levels: `fingerprint`/`restoreLevels` (`web/lib/learnEngine.mjs:30-45`). Python copies: `backend/routers/guides.py:102-104`, `backend/services/learning_events.py:36-39`. Bridges Learn levels to cards (`guides.py:107-124`). `learning_events.item_id = '<guide>:<fingerprint>'` (`learning_events.py:47-48`) |
| Full question text key | `retain_misses` (`web/lib/retainMisses.mjs:8-25`); Study now dedupe (`studyQueue.mjs:84-97`) |
| Hash of question + answer | `study_aids.item_key` (`backend/services/learning_styles.py:154-155`) |

**What breaks when an author edits.**
- **`PATCH /guides/{id}` changes `study_guide` or `flashcards` but never `quiz_questions`**
  (`guides.py:183-208`). Learn and Quiz keep the old cached questions until
  `POST /quiz/{id}/regenerate` (`quiz.py:359-362`).
- **Edit card 3's text:**
  - Its spaced-review box stays and now applies to the new text; no content check exists
    (`web/lib/spacedReview.mjs:28-33`).
  - After a quiz regeneration, that idea's Learn level resets to New (`learnEngine.mjs:36-45`).
  - The stale entry stays stored, because the merge never deletes (`mcp_write_tools.sql:143-166`).
  - The Library "mastered" count still counts it (`web/pages/library.js:52-56`).
  - The old miss stays in Study now (`studyQueue.mjs:72-97`).
  - `learning_events` history splits under a new `item_id`.
- **Insert a question at the top:**
  - Every card's box shifts onto the card before it. The last card loses its schedule.
  - After a quiz regeneration, every Learn level resets to New.
  - Connected apps' saved `card_id` / `question_id` values point at different items.
  - Stats map `question_index` to the wrong questions (`backend/routers/stats.py:49-55`;
    `backend/services/study_insights.py:92-103`).
- **Regenerating a guide** renumbers every pair, so all index-keyed progress becomes meaningless.
  Text-keyed stores (retain misses, events, aids) survive only if the wording is unchanged.

---

## 3. `flashcard_progress`: shape and data flow

**Shape** (`supabase/schema/live-2026-11.sql:957`; documented in `Cordia-Classroom-Brief.md:400`).
Two index spaces share one blob:

```json
{
  "known": [0, 4], "unknown": [2], "last_studied": "2026-11-04T19:00:00.000Z",
  "schedule": { "0": {"box": 1, "due": "2026-11-06"}, "2": {"box": 0, "due": "2026-11-05"} },
  "learn": {
    "levels": { "0": {"l": 1, "q": "what is the powerhouse of the cell", "sure": true, "at": "2026-11-04"} },
    "test_date": "2026-12-01"
  }
}
```

- `schedule`, `known` and `unknown` are keyed by flashcard position. Box intervals are
  `[1,2,4,7,15,30]` days (`web/lib/spacedReview.mjs:4`).
- `learn.levels` is keyed by quiz-question position. `l` runs 0–3, Mastered fades after 5 days, and
  `sure` is stored only when true (`web/lib/learnEngine.mjs:10-16, 51, 56-58`).
- Study now misses are not stored here; they live in `retain_misses` (`live-2026-11.sql:767-783`).
- Confidence is stored only as the `sure` flag.

**Writers**
- **Main path:** `apply_study_progress()` (`supabase/migrations/20261102120000_mcp_write_tools.sql:80-172`).
  - It locks the row and requires `g.user_id = owner` (`:97`).
  - It merges entry by entry and checks each card index against the number of cards (`:121`). Learn
    indexes get no bounds check.
- **Browser:** calls `merge_study_progress()` (`:177-194`) directly as RPC via `web/lib/progressSave.js:10-17`.
  - Callers: `web/pages/flashcards/study.js:42-54`, `web/pages/play/[guideId].js:33-44`,
    `web/pages/session.js:51-77`, `web/pages/learn/[guideId].js:221-232, 284-303`.
- **Fallback routes**, which replace the whole object:
  - `PATCH /guides/{id}/flashcard-progress` (`backend/routers/guides.py:323-371`).
  - `PATCH /guides/{id}/learn-progress` (`guides.py:377-421`).
- **Connected apps:** `mcp_record_answer()` (`mcp_write_tools.sql:212-300`), from
  `web/lib/mcp/writeTools.mjs:29-82` and `web/lib/studyAnswer.mjs:84-116`.
- **Learn's local copy:** also kept in `localStorage['cordiaLearn:'+guideId]`, which is **not
  scoped per user** (`web/pages/learn/[guideId].js:28, 39-41, 223`).

**Readers**
- **Guide API:**
  - The guide list returns the blob plus `flashcard_learn` (`guides.py:63, 91-124`).
  - Single-guide fields include it (`guides.py:211-214`).
- **Study and review screens:**
  - `spacedReview.mjs:28-41`.
  - `studyQueue.mjs:22-53, 104-116` (Study now / Daily review, and MCP `get_due_cards` at `readTools.mjs:254-298`).
  - `studyAnswer.mjs:84-132`.
- **Readiness and progress displays:**
  - `examCountdown.mjs:17-38`, used by the Dashboard (`web/pages/dashboard.js:186-195`).
  - `library.js:52-56, 274`.
  - `web/components/KnowledgeMap.js:20-32` (Progress page, `web/pages/progress.js:29, 62`).
  - `BlockGame.js:40`.
- **MCP reads:** `readTools.mjs:119-122, 145-147, 255, 289`, with the column granted to `mcp_client`
  at `20261101120000_mcp_read_access.sql:246-249`.
- **Admin metrics:** `backend/services/metrics.py:183` (`test_date`).
- **Not readers:**
  - `backend/routers/stats.py` reads `quiz_attempts`, `study_sessions` and `user_streaks` instead
    (`:36-70`, `:171-299`).
  - The extension never reads or writes it; it only POSTs `/guides` (`extension/background.js:199-205`).
- **Cordia Assistant (separate repo, unverified):** the plan says it keeps its own copy of the fade
  and fingerprint in `exam-prep.ts` (`plans/pending/personalization.md:51-53`). That implies it reads
  `flashcard_progress.learn` directly with the service role. Its code is not in this repo, and no API
  or MCP path in this repo serves it.

**Other progress stores** that Stage 4 must keep consistent:

| Store | Keyed by | Written by |
| --- | --- | --- |
| `retain_misses` (`live-2026-11.sql:767-783`) | (user, guide), items by full question text | `web/lib/userStore.js:48-66`, Learn, Quiz (`web/components/QuizMode.js:39-45`), Study now, MCP |
| `quiz_attempts.answers` (`:746-757`) | `question_index` into `quiz_questions` (NCLEX: into `nclex_questions`) | `backend/routers/quiz.py:507-532`; `backend/routers/nclex.py:95-102` |
| `study_sessions` (`:989-998`) | session row; `metadata.cards_studied` | `backend/routers/stats.py:488-533`; `quiz.py:535-541` |
| `learning_events` (`:551-587`) | `item_id = '<guide>:<fingerprint>'` | `backend/routers/learning.py:329-340`; `backend/routers/mcp.py:173-189` |
| `study_days` | day, with per-guide counts keyed by the first 8 characters of the guide id | `web/lib/studyDays.mjs:1-3`; `serverCopies.js:26-31` |
| `user_streaks` (`:1093-1106`) | user | `stats.py:123-155` |
| `shared_set_studiers` (`:816-827`) | (set, user) | `backend/routers/classes.py:441-452` |
| `study_aids` (`:887-901`) | sha256 of question + answer | `backend/services/learning_styles.py:154-155` |
| `practice_state.progress` | problem index | `mcp_write_tools.sql:264-280` |
| `read_progress` | one fraction per guide | `web/pages/guide/[id].js:176-184` |

---

## 4. `shared_sets` versions and "Update available"

**A shared set is a snapshot, one row per guide, overwritten in place.**
- `upsert_share` (`backend/services/sharing.py:57-89`) copies `title` (≤300 chars), `study_guide`
  (≤200k chars), `flashcards` (front/back only), `card_count` and `owner_name`.
- Notes, quiz questions and progress are never copied (`20261015120000_canvas_classes.sql:235-236`).
- `guide_id` is unique (`:239`), so there is no version history.
- `version` goes up by 1 only when the title, text or cards change (`sharing.py:70-71`).
- Every refresh re-runs the "held for review" screen. A set an admin restored can go back to held on
  its next edit (`sharing.py:63, 72-77`). `hidden` and `taken_down` stick.

**When the snapshot refreshes.** `on_guide_changed` (`sharing.py:92-102`) runs only from
`PATCH /guides/{id}` and the rename route (`backend/routers/guides.py:206-207, 289`). These paths
change content without refreshing it:
- MCP `mcp_add_flashcards`;
- the review-set restore (`backend/routers/plans.py:357`);
- `backend/scripts/retitle_guides.py:45`.

**Studying a set means owning a copy.**
- `POST /sharing/sets/{id}/save` inserts a new `study_guides` row owned by the studier, with
  `linked_set_id` and `linked_set_version` (`backend/routers/classes.py:385-399`).
- It copies no quiz questions and no progress.
- There is no route for studying a set without saving it.
- Every progress write lands on the studier's copy. **No path writes a studier's activity to the
  author's guide row.** Every `study_guides` write filters on `user_id`, and the SQL functions check
  the owner (`mcp_write_tools.sql:97, 233, 338-339`).

**"Update available".**
- Computed in `guide_sharing` (`classes.py:316-320`):
  `source.status == 'visible' and source.version > linked_set_version`.
- It **does not check visibility or membership**. If the author made the set private, the chip still
  shows, and accepting returns 404 from `_readable_set`.
- Accepting runs `POST /sharing/guides/{id}/update` → `update_copy` (`classes.py:402-413`), which
  overwrites title, text and cards.
- **It leaves `flashcard_progress` and `quiz_questions` alone.** Index-keyed progress therefore
  lands on the wrong cards, and the cached quiz goes stale (see §2).
- **The "N versions" menu in class sets is not version history.** It shows near-duplicate clusters
  (Jaccard ≥0.6; `class_catalog.py:113-122`, `sharing.py:43-54, 128-133`), rendered at
  `web/components/ClassSets.js:46-52`.

---

## 5. Every place sharing visibility is checked

The backend always uses the service-role client (`backend/database.py:52-53`), so **RLS never
applies to backend reads or writes**. Every check is in Python.

| Check | Where | Notes |
| --- | --- | --- |
| `_readable_set`: owner, or (`class` + `visible` + member of the class) | `classes.py:367-375` | Used by get, save, update and report (`:378-433`). No `public` branch, and no `sharing_blocked` check (blocking forces the visibility to private instead) |
| `_member_class` → `is_member` | `classes.py:49-53`; `class_db.py:109-110` | Class page, deadlines, file, share-default |
| Class page filters `class` + `visible`; empty when `sharing_blocked` | `classes.py:166-172` | Uses `ranked_entries` (`sharing.py:105-133`), which trusts its caller |
| Counts of visible sets per class | `classes.py:66` | |
| `sharing_blocked` | `set_visibility` refuses `class` (`classes.py:340-341`); `_file` skips auto-share (`:210`) | `share_default` relies on the DB trigger `enforce_class_sharing` (`canvas_classes.sql:317-332`) |
| Owner-only guide access | `_guide` (`classes.py:35-39`); `unfile_guide` (`:272`); `on_guide_changed` (`sharing.py:95, 98`) | |
| Report auto-hide at 3 distinct reporters | `report_set` (`classes.py:420-433`) and trigger `hide_reported_set` (`canvas_classes.sql:299-315`) | Whether the trigger exists live is unverified; the snapshot lists no triggers |
| Held for review | `screen_share` (`class_catalog.py:82-99`), applied only for `class` visibility (`sharing.py:63`) | |
| Takedown → `taken_down` | `public_forms.py:94-116` | **Unauthenticated.** Any set whose UUID appears in the text is taken down at once (rate limit: 5 per hour per IP) |
| Admin decisions | `require_admin` (`admin.py:29-34`); `decide_set`, `decide_takedown` (`:82-92`, `:124-137`) | |
| DB RLS on `shared_sets` (direct reads only) | `20261022130000_public_sets.sql:34-39` | Owner, `public`+`visible`, or `class`+`visible`+member. No web code reads the table directly |

**Endpoints that skip a visibility check:**
- `studied` (`classes.py:441-452`) records studying a set even when it is hidden, private or taken
  down.
- `guide_sharing`'s update check, described in §4.
- **`instructor_blocks` is written but never read** (`public_forms.py:79` is the only reference). The
  block works by setting `classes.sharing_blocked` and making the class's sets private (`:78`), and
  no unblock exists.
- `public` visibility exists in the database (`public_sets.sql:15-18`), but no backend route writes
  it: `VisibilityRequest` is `Literal["private","class"]` (`classes.py:299-300`).

---

## 6. What the browser reads directly vs through the API

The browser's Supabase client exposes only `.auth` (`web/lib/supabase.js:12-19`). Tables are reached
through a small PostgREST client that sends the student's own token (`web/lib/supabaseRest.mjs:4-24`,
`web/lib/serverCopies.js:10-15`).

| Direct from the browser (student's token) | Where |
| --- | --- |
| `retain_misses` (read, upsert, delete) | `web/lib/serverCopies.js:17-24`, `web/lib/serverSync.js:46, 62` |
| `study_days` (read, upsert) | `serverCopies.js:26-31`, `serverSync.js:46, 63` |
| `study_guides` (ids only) | `serverSync.js:27` |
| RPCs `merge_study_progress`, `set_my_timezone`, `search_my_materials` | `web/lib/progressSave.js:12`, `serverSync.js:21`, `web/components/SearchModal.js:49` |
| `mcp_connection_activity` | `web/lib/oauthConsent.mjs:51` |

- **Server routes with the service role** (`web/pages/api`, `web/lib/server`):
  - card and feedback images: `cardImages.mjs`;
  - `note_covers`, `lectures` and `lecture_todos`;
  - `visual_cache`, `guide_visuals`;
  - storage buckets.
- **The MCP endpoint** uses the connected app's token, not the service role (`web/lib/mcp/auth.mjs:5-34`).
- **Only through FastAPI:** every sharing and class table (`schools`, `classes`, `class_terms`,
  `class_memberships`, `class_merge_proposals`, `sharing_settings`, `class_share_defaults`, the
  `shared_set*` tables, `instructor_blocks`, `copyright_takedowns`, `app_admins`), plus guide and
  folder content, `user_profiles`, `user_streaks`, `study_sessions` and `quiz_attempts`. This
  matches the rule stated in `20261015120000_canvas_classes.sql:3-5`.

**Live write policies that shouldn't be there (drift).**
- `20260915035012_harden_classroom_rls.sql:1-22` drops the browser insert/update/delete policies on
  `folders`, `study_guides`, `quiz_attempts`, `study_sessions` and `user_streaks`.
- `supabase/schema/README.md:43-44` lists the file as applied.
- But the live snapshot still has the policies: `folders` `live-2026-11.sql:455-462`, `study_guides`
  `:980-987`, `quiz_attempts` `:758-763`, `study_sessions` `:1001-1006`, `user_streaks` `:1101-1104`.
- So **today a signed-in browser can insert or update its own rows in those tables directly**,
  bypassing FastAPI's validation. That includes `study_guides.visibility`-style columns once Stage 3
  adds them.
- The check query is in §8.

**`user_profiles` holds `email`, `name`, `university`, `major` and `timezone`**
(`live-2026-11.sql:1076-1091`).
- Its RLS allows reading your own row only. `mcp_client` gets a column grant for `(id, timezone)`
  only (`20261101120000_mcp_read_access.sql:266`).
- A policy like "SELECT where `profile_visibility = 'public'`" would expose every public user's email
  through PostgREST, because RLS filters rows, not columns.

---

## 7. Migrations marked NOT APPLIED

| File | Header | What's known |
| --- | --- | --- |
| `20261105140000_trim_day_long_sessions.sql` | `:2` NOT APPLIED | Listed as pending in `supabase/schema/README.md:63`. Whether the owner ran it isn't recorded |
| `20261106120000_experiments.sql` | `:2` NOT APPLIED | The owner reported applying it on 2026-11-05. The header wasn't updated |
| `20261106130000_onboarding_answers.sql` | `:3` NOT APPLIED | The owner reported applying it. Adds `user_profiles.study_archetype`/`archetype_version` and `onboarding_answers`. The header wasn't updated |

- Two of these files are dated 2026-11-06, after today.
- The history also has five applied migrations with no file in the repo (`README.md:16-24`),
  including `assistant_links` from the Assistant repo.
- **The repo has no rollback sections**; files are written to be safe to re-run. Starting with
  Stage 1, new migrations add a commented rollback as the plan requires.

---

## 8. Read-only checks for the owner

Run in the Supabase SQL editor. None of these change anything.

```sql
-- 1. Do the browser write policies from harden_classroom_rls still exist? (expect 0 rows)
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('folders','study_guides','quiz_attempts','study_sessions','user_streaks')
  and cmd in ('INSERT','UPDATE','DELETE');

-- 2. Do the shared-set triggers exist? (expect hide_reported_set and enforce_class_sharing)
select tgname, tgrelid::regclass from pg_trigger
where not tgisinternal and tgrelid in ('public.shared_sets'::regclass, 'public.shared_set_reports'::regclass);

-- 3. Which pending migrations are live?
select to_regclass('public.experiment_assignments') as experiments,
       to_regclass('public.onboarding_answers') as onboarding_answers,
       (select count(*) from public.study_sessions where duration_seconds > 3*3600) as long_sessions_left;

-- 4. Sharing today: how much would the Stage 3 data migration touch?
select visibility, status, count(*) from public.shared_sets group by 1, 2 order by 1, 2;
select count(*) as saved_copies from public.study_guides where linked_set_id is not null;
select count(*) as schools_with_domains from public.schools where cardinality(email_domains) > 0;
```

---

## 9. What this changes in later stages

Recommendations only. Each stage confirms these before it starts.

- **Before Stage 1: close the write-policy drift (§6).** It is a separate one-file migration that
  drops the five tables' browser write policies again. Run check 1 first.
- **Stage 1 (profiles):**
  - Keep `user_profiles` RLS as "your own row only". Serve other people's profiles only through
    `GET /profiles/{username}`, which picks the allowed fields.
  - The browser never reads `user_profiles` directly today, so nothing is lost.
  - Reserved usernames should include every top-level route in `web/pages` (`admin`, `assistant`,
    `billing`, `calendar`, `canvas`, `class`, `connect`, `copyright`, `create`, `dashboard`,
    `feedback-review`, `flashcards`, `folder`, `games`, `guide`, `honor-code`, `install-extension`,
    `instructors`, `learn`, `lecture`, `library`, `login`, `mission`, `nclex`, `oauth`, `play`,
    `practice`, `pricing`, `privacy`, `progress`, `quiz`, `reset-password`, `session`, `settings`,
    `signup`, `smartnotes`, `terms`, `tutor`, `week`, `mcp`, `auth`, `api`), plus the plan's list.
  - **Name clash:** `display_name` already exists on `classes` (`live-2026-11.sql:264`). There is no
    clash on `user_profiles`, but grep both when reading.
- **Stage 2 (rate limits):** `ai_rate_limit` counts in memory per Fly machine and per token
  (`backend/rate_limit.py:1-4, 29-50`). It resets on deploy and can't enforce "100 a day". Use a
  database counter, like `mcp_take_call` (`20261102120000_mcp_write_tools.sql:487-508`).
- **Stage 3 (visibility):**
  - `visibility` already names a column on `shared_sets` (`private`/`class`/`public`). The new enum
    on `study_guides` is a different thing; keep the names apart in code.
  - Existing saved copies (`linked_set_id`) map to "Make a copy" lineage
    (`forked_from_guide_id = shared_sets.guide_id`, `forked_from_version = linked_set_version`). Keep
    them as the studier's own guides.
  - **Open question:** the planned data migration turns course-shared guides **public** and
    anonymous. Today those guides are visible only to course members. That widens the audience
    without the author's consent, even when anonymous. Option: migrate them to `classroom`/link-only
    until the author confirms in the planned banner. Owner's call.
  - The takedown form already accepts `/sets/<uuid>` (`public_forms.py:91`). Once `/sets/{id}` URLs
    are public, **anyone can take down any public guide** with one unauthenticated form (5 per hour
    per IP). Recommendation: change it to "held pending review" in Stage 3, not Stage 9.
- **Stage 4 (per-viewer progress):**
  - `idea_id` must cover both arrays (`flashcards` and `quiz_questions`) and the `Qn:` text. Matching
    by ID, then fingerprint, as planned, also fixes the existing card↔quiz drift in §2.
  - **Overlap:** the personalization plan's Phase 2 `item_memory(user_id, item_id, …)` already plans
    per-user, per-idea FSRS memory (`plans/pending/personalization.md:388-515`). Recommendation:
    - one stable `idea_id`, used as `item_memory.item_id = '<guide>:<idea_id>'` and as the
      `learning_events.item_id` that today uses the fingerprint;
    - `guide_progress` keeps per-guide state (`version_seen`, `test_date`, archived ideas) plus
      today's box and Learn level until FSRS replaces them.
    - Two per-idea stores that each hold FSRS fields would drift.
  - Writers to move are `apply_study_progress`, `merge_study_progress` (called directly from the
    browser), `mcp_record_answer`, `mcp_add_flashcards` and both PATCH fallbacks.
  - MCP ids `<guide>:card:<i>` are an external contract with connected apps. Keep accepting them
    during the change.
  - The Assistant likely reads `flashcard_progress.learn` directly, so keep writing the owner's blob
    (shim) until its repo moves.
  - Make the `cordiaLearn:<guideId>` local copy user-scoped.
- **Stage 5 (classrooms):** see §10. The "verified school email instructor check" is weak (§1).
  Either fill `schools.email_domains` (admin tool or seed) or gate `instructor_class` on admin
  approval at first.
- **Stage 7 (search):** `study_guides.search_doc` already exists. It is a generated tsvector over
  title, notes and text with a GIN index (`20261101120000_mcp_read_access.sql:127-132`). Reuse it,
  extended to the outline and Q/A, instead of adding `search_tsv`.
- **Stage 9 (minors):** Classroom stores no birthdate or age. The Privacy page says the service isn't
  for under-13s (`web/pages/privacy.js:158-159`). The Assistant's setup only asks "18 or older"
  (`web/components/assistant/AssistantSetup.js:89-99`), stored in the Assistant's own schema
  (unverified). `is_minor` needs a source, such as a sign-up question, before gating means
  anything.

Pre-existing bugs found on the way, out of scope for Stage 0:
- `update_available` ignores visibility (§4).
- `studied` ignores visibility (§5).
- MCP `get_due_cards` builds history keys as `guide + '\n' + item_id` but looks them up as
  `guide + '\n' + fingerprint` (`web/lib/mcp/readTools.mjs:272` vs `:282`). Because `item_id` already
  contains `guide:`, `last_confidence` is always empty in production. A test fixture hides this
  (`web/tests/mcp-read-tools.test.mjs:86`); unverified at runtime.

---

## 10. Classrooms: new tables, or extend `classes` / `class_memberships`?

**Recommendation: new tables (`classrooms`, `classroom_members`, …). A course (`classes` +
`class_terms`) stays the course identity and the anonymous Class-sets pool. A classroom is an
explicit group with roles that can optionally link to a course and term.**

| | New `classrooms` tables | Extend `classes` / `class_memberships` |
| --- | --- | --- |
| Meaning | Clean: membership is an invitation with a role and status | `class_memberships` means "I say I take this course" from Canvas, Calendar or a typed code (§1). Adding roles and invites would mix self-claimed enrollment with granted access |
| Security | Membership is granted (owner invites, approval, caps), so it can gate `classroom`-visibility guides | Anyone can join a course by typing its code (`classes.py:127-151`). Gating private content on it would leak |
| Roster privacy | Members list is visible to members by design | Course membership is deliberately "never a roster" (`canvas_classes.sql:136`) |
| Courses without Canvas | Study groups need no course code (the code check at `classes.py:139-140` rejects free names) | Every row needs a normalized code, school and term |
| Merges | Unaffected by admin course merges (`admin.py:99-121`) | Merges move memberships between classes. Roles and invites would move with them unexpectedly |
| Cost | Four new tables plus `is_classroom_member`. A course page shows "Classrooms for this course" through `classrooms.class_id` | Fewer tables, but every existing reader of `class_memberships` (Canvas import, `folders.lms_named` backfill, MCP grants) would need to learn the difference |

**Naming conflicts to settle up front:**
- **The product is "Cordia *Classroom*".** In-app copy saying "Classrooms" next to the brand may
  confuse. The UI already says "Class" / "Classes" for courses (`web/components/Sidebar.js:253-276`,
  `web/pages/class/[id].js`).
  - Suggested labels: **"Study groups"** for `study_group` and **"Class spaces"** for
    `instructor_class`, with `classrooms` kept only as the table and route name. Or keep
    "Classrooms" if the owner prefers. It is an owner's call before Stage 5.
- The route `/class/[id]` (a course) and a new `/classrooms/[id]` would sit side by side. That is
  fine technically, but the labels must differ.
- `classes.display_name` vs `user_profiles.display_name`: both are fine, but don't mix them in joins.
