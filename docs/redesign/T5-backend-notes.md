# T5 Saved chats: backend hand-off

For the builder of the T5 screens. Backend only; nothing here is live until the owner runs
`cd backend && fly deploy`, and the new columns do not exist until the owner applies
`supabase/migrations/20261130120000_saved_chats.sql` (marked NOT APPLIED).

## How Tutor conversations are stored today

- `tutor_sessions`: one row per student (unique `user_id`). It is the **live conversation**: `messages`
  (last 60), `conversation_version`, `status`, the browser fields. The web Tutor reads and writes it through
  `GET /tutor/session` and `POST /chat` (with `session_id`).
- `tutor_chats`: saved conversations (`guide_id`, `title`, `messages`, times). "New chat" saves the live
  conversation here (`POST /tutor/session/new`), "resume" moved one back and deleted the row. Kept to the
  newest 30. Both tables are service-role only.
- The **Chrome extension's Tutor does not use either table.** It sends `POST /chat` with no `session_id`
  and its own `history`. "Session state shared with the extension" therefore means `/chat` and the session
  contract are unchanged; nothing in `extension/` was touched.

## Data model (the migration)

No new table. Four columns, one check and four indexes on `tutor_chats` (the migration is one transaction):

| Column | Meaning |
| --- | --- |
| `class_id` | the class (`folders.id`) the chat belongs to, null = none; `on delete set null` |
| `renamed` | true once the student typed a title; until then the title is the first message |
| `live` | this row is the Tutor's current conversation (at most one per student, partial unique index) |
| `deleted_at` | soft delete; Undo clears it; deleted chats are removed for good 30 days after deletion (daily job, see below) |

The check `tutor_chats_live_not_deleted` (`not (live and deleted_at is not null)`) makes a chat that is both the
current conversation and deleted impossible: a racing write fails with a database error and the backend answers it
as 409. Indexes: one live chat per student; `(user_id, class_id, updated_at desc) where deleted_at is null` for the
lists; `(class_id) where class_id is not null` so deleting a class (`on delete set null`) does not scan the table;
`(deleted_at) where deleted_at is not null` for the purge.

`updated_at` stays the last activity; renaming or moving does not change it. While a chat is live its
messages are read from `tutor_sessions` (the row keeps a copy only when the conversation moves on), so
nothing is stored twice and the extension-shared session stays the single source of truth.
RLS is on with no client policy and no client grant, the same as `tutor_chats` and `tutor_sessions`: the
owner check is in the endpoints, and every query also filters on `user_id`.
The migration backfills `class_id` for existing chats that are about a guide (the guide's class), only when the guide
and the class are the chat owner's own. The backfill sits in the block that adds `class_id`, so it runs only the first
time the file is applied: running the file again after launch changes nothing and never re-files a chat a student moved
out of a class. The backend applies the same ownership rule (`saved_chats._guide_classes`): a guide's folder counts
only if it is one of the student's own folders.

## How existing history becomes chats

- Saved chats keep their id, title, messages and times. After the migration they simply gain the new columns.
- A conversation that is in `tutor_sessions` but has no live row (everything from before this) gets its
  live row the first time `GET /chats` or `GET /chats/{id}` or a start sees it. The row has empty
  `messages`; the session holds them. So it is listed once and nothing is copied.
- `GET /tutor/chats` (the Tutor panel's Past chats) is unchanged in shape; after the migration it leaves out
  the live chat and deleted chats. `POST /tutor/session/new` is unchanged in shape and now keeps the saved
  chat's row (and so its id, title and class) when it is resumed.

## Endpoints (`backend/routers/chats.py`, prefix `/chats`, signed-in student only)

Chat summary: `{id, title, guide_id, class_id, live, created_at, updated_at}`.
`editable` is false until the migration has run.

| Call | Request | Response |
| --- | --- | --- |
| `GET /chats?limit=30&class_id=` | `limit` 1-100, `class_id` a uuid | `{chats: [summary], editable}` newest activity first; the live chat included when it has messages |
| `POST /chats` | `{guide_id?, class_id?, session_id?}` | `{chat: summary, session: <GET /tutor/session shape>}`: saves the current conversation, starts an empty live chat. Navigate to `chat.id` |
| `GET /chats/{id}` | | `{chat: summary + messages [+ session_id, conversation_version when live]}`, `editable` |
| `PATCH /chats/{id}` | `{title?}` and/or `{class_id?}` (`null` moves out of a class) | `{chat: summary, editable}` |
| `DELETE /chats/{id}` | | `{chat: summary + deleted_at, editable}` (soft; the live chat also clears the Tutor) |
| `POST /chats/{id}/restore` | | `{chat: summary, editable}` (Undo; comes back as a saved chat) |
| `POST /chats/{id}/open` | | `{chat, session}`: makes a saved chat the current conversation so the student can continue it |

Messages keep the stored shape (`{role: "user"|"ai", text, source?, guide?, link?, confirm?, visual?, evidence?}`).
Errors: 400 bad id, 401 signed out, 404 not yours / gone / deleted (also a class or guide that is not yours),
409 the Tutor is working, or the conversation moved on (also: two tabs raced, or a database rule refused a racing write);
refresh and retry. No route answers 500 for a race, and none answers 500 before the migration.

## Before the migration is applied (live database today)

- `GET /chats`: 200 with the saved chats plus the live conversation; `editable: false`. The live
  conversation's `id` is the **Tutor session's id**. Titles come from the first message. A guide's chat
  counts as in the guide's class, so the class filter works.
- `GET /chats/{id}`: works for a saved chat and for the session id.
- `PATCH`, `DELETE`, `restore`: HTTP 503 with body `{"detail": "Saved chats aren't set up yet.", "code": "chats_not_available"}`
  (`apiFetch` returns the body without the status, so test `code`). Grey out Rename, Move and Delete when
  `editable` is false.
- `POST /chats` and `POST /chats/{id}/open` still work, through the old save/resume. The returned `chat.id`
  is the session id for the live chat, and opening a saved chat moves it into the session (its old id goes).
  Always navigate to the `chat.id` in the response. A URL made before the migration shows whatever is
  live under that session id; after it, `/chats/{session id}` still finds the live chat.

## What the UI builder needs to know

- **Send messages as today**: `POST /chat` with `session_id`, `conversation_version` and `class_id` set to the
  chat's `class_id`. For a chat that is not live, call `POST /chats/{id}/open` first (one live chat at a time).
  A reload of `/chat/[id]` is `GET /chats/{id}`; if `live` is true use its `session_id` and
  `conversation_version`.
- New endpoints answer 404 on the backend that is live now (not deployed). Fall back to `GET /tutor/chats`
  and the existing session calls when `/chats` returns no `chats` array.
- A deleted live chat becomes a saved, deleted chat and the Tutor is empty. Undo returns it as saved, not live.
- Starting a chat while the current one is empty reuses the empty live chat (its guide and class are replaced).
- **Two tabs.** Every change of the live chat (new chat, open, delete of the live chat) first resets the Tutor session
  with its version check, so of two overlapping requests only one gets through; the other answers 409 and changed
  nothing. On a 409, refetch (`GET /chats/{id}` or `GET /tutor/session`) and show what is current. A tab that was
  told about a chat that another tab deleted a moment later gets 404 on it; send it back to the list.
  The student's conversation is never lost: if a step after the reset cannot be done, the session is put back,
  or the conversation is saved as a chat of its own.
- The 30-saved-chat cap in `start_tutor_chat` (the pre-migration path) still deletes the oldest chats beyond 30.
  After the migration the new path does not prune; only deleted chats are purged (30 days). See the owner's
  decisions below.
- `account_export` still exports every row, including deleted ones, which now carry a deleted marker (below);
  `memory_context` skips deleted chats.
- `tests/qa/mock-api.cjs` has no `/chats` routes; the UI task adds them.

## Owner decisions (Jude)

1. **No trim to the newest 30 saved chats after the migration.** Approved. Already how the code works:
   `saved_chats.start_chat` never prunes saved chats (`list_chats` shows 30 per page by default, up to 100, and
   deletes nothing). Only the pre-migration path, `tutor_sessions.start_tutor_chat` (`MAX_SAVED_CHATS`), trims, and
   it stops being used once the migration is applied.
2. **Deleted chats are purged 30 days after deletion.** Approved. The 30 is one named constant, `DELETED_KEEP_DAYS` in
   `backend/services/saved_chats.py`; the purge and the account export both read it. The purge now runs daily for every
   student (see "The daily purge"), and still also when a student starts a chat (`_purge_deleted`, their rows only),
   with one shared filter so the two cannot drift. A chat is therefore permanently deleted on its `purge_on` date or
   within a day after it.
3. **The account export keeps deleted chats while they exist, but marks them.** In `tutor_chats`, a chat with
   `deleted_at` set gets `"deleted": true`, `"deleted_at"` (when it was deleted) and `"purge_on"` (`deleted_at` plus
   `DELETED_KEEP_DAYS`). Chats that are not deleted get none of these fields, so they export exactly as before.
   When the export holds a deleted chat it also carries a top-level `"deleted_chats_note"` in plain words: the chat
   is permanently deleted on `purge_on`, and because the clean-up runs once a day, within a day of that date. Before the
   migration (no `deleted_at` column) the export reads the old columns and works as it did, detected with
   `saved_chats.is_missing_schema`. Code: `backend/services/account_export.py`; tests: `tests/test_tutor_data_controls.py`.

**For the pull request description:** it must say that the privacy policy needs a sentence saying deleted chats are
purged 30 days after deletion (and that the data export includes them, marked deleted, until then).

## Review fixes (second pass)

The first review of the backend failed on one High finding. What changed, and the test that proves each fix
(all in `tests/test_saved_chats.py`; the database there is a fake that enforces the one-live-chat index and the
live-and-deleted check, with hooks that run the other tab's whole request at an exact step of this one):

| Finding | Fix | Test |
| --- | --- | --- |
| H1: a chat could end up live and deleted (a new chat or the old panel's automatic `POST /tutor/session/new` racing a delete in another tab; open racing delete) and the student's next messages were filed under a deleted chat and purged | Database check; every write that sets or relies on `live` also filters `deleted_at is null` and checks that it changed a row; the non-live delete requires `live = false`; the session is reset first, and a step that cannot be done puts the conversation back or saves it as a chat of its own | `test_scenario_a_a_delete_in_another_tab_wins_before_a_new_chat_resets_the_tutor`, `test_scenario_a_the_delete_lands_after_the_new_chat_took_the_conversation`, `test_scenario_b_opening_a_chat_while_another_tab_deletes_it`, `test_deleting_a_saved_chat_that_became_live_meanwhile_is_refused`, `test_the_database_check_is_what_the_code_falls_back_on_and_it_answers_409_not_500`, `test_deleting_the_live_chat_when_its_row_cannot_be_written_puts_the_conversation_back`, `test_if_the_conversation_cannot_be_put_back_it_is_saved_as_a_chat_of_its_own` |
| M1: two overlapping new-chat or open requests gave a 500, sometimes saved the conversation twice | Version-checked session reset first (one winner); unique violations answer 409 or settle on the live chat the other request made; empty `data` is checked | `test_p1_two_tabs_start_a_new_chat_at_once`, `test_p1b_the_second_tab_reads_after_the_first_saved_the_conversation_but_before_it_made_the_new_chat`, `test_a_live_chat_that_vanishes_before_it_is_reused_is_replaced_not_a_500`, `test_opening_a_chat_when_a_stray_live_chat_appears_is_a_409_and_keeps_the_conversation` |
| M2: a guide's folder was trusted as the chat's class | Backfill and `_guide_classes` check the guide and the folder belong to the chat's owner | `test_a_guide_whose_folder_belongs_to_another_student_gives_the_chat_no_class`, `MigrationFileTests.test_the_backfill_runs_only_the_first_time_and_only_with_the_owners_guide_and_class` |
| Migration | One transaction; backfill runs only when the file creates `class_id`; `class_id` index | `MigrationFileTests` |
| Low | Open of the live conversation by the id `GET /chats` gave it works before the migration; the missing-schema matcher matches whole column names; second-student resume and other-student purge tests added | `test_opening_the_live_conversation_by_the_id_the_list_gave_it_returns_it`, `MissingSchemaMatcherTests`, `test_a_second_student_resumes_through_the_tutor_panels_route`, `test_the_students_own_purge_leaves_another_students_deleted_chats_alone` |

## The daily purge

Deleted chats are removed for good by a job in the **existing background sync worker** (`backend/services/sync_worker.py`,
the thread started on Fly at app start; no second worker, no new scheduler).

- **What triggers it.** The worker loop wakes once a minute; `saved_chats.run_purge_if_due()` runs on the first pass at
  or after 09:00 UTC each day (about 4 a.m. US Eastern) and not again that day, the same pattern as the nightly decision
  outcomes. After a database error it tries again an hour later, not every minute. A restart of the machine can repeat a
  run the same day; that is harmless.
- **What it can remove.** `deleted_at is not null and deleted_at < (now in UTC - DELETED_KEEP_DAYS days) and live = false`.
  One function (`_expired`) holds that filter and both the job and the purge on a student's next chat use it, with the one
  constant. A row with `deleted_at` null is never touched. It first picks up to 100 ids with the filter, then deletes
  those ids with the same filter again, at most 100 batches (10,000 chats) per run; the rest goes the next day.
- **Safe.** Running it twice removes nothing the second time; two machines at once just delete overlapping batches.
  Before the migration (no `deleted_at` column) it removes nothing and logs one line; any other database error is
  logged and does not stop the worker's other jobs. The log says how many chats it removed, never titles or messages.
- **Not live yet.** The job runs only after the owner deploys the backend (`cd backend && fly deploy`) and applies the
  migration. Until then deleted chats are still only purged when their student starts a chat, which is why the privacy
  policy line ("deleted chats are purged 30 days after deletion") is not yet true for students who never come back.
- **Wording.** The job runs once a day, so a chat becomes eligible at some hour on its `purge_on` date and is removed at
  the next run, at most a day later. The export note says "permanently deleted on `purge_on` ... within a day of that
  date".

## Before the owner applies the migration

1. Run these read-only checks on the live database; **both should return 0**. (A non-zero result means a guide or a
   folder is attached to another student's chat; the backfill now ignores those, but ask before applying.)
   ```sql
   select count(*) from tutor_chats c join study_guides g on g.id = c.guide_id where g.user_id is distinct from c.user_id;
   select count(*) from tutor_chats c join study_guides g on g.id = c.guide_id join folders f on f.id = g.folder_id where f.user_id is distinct from c.user_id;
   ```
2. Deploy the backend first (`cd backend && fly deploy`), then apply the migration. The backend works before and after.
3. **Never roll the backend back to an older release after the migration is applied.** The old code trims saved chats to
   the newest 30 (`MAX_SAVED_CHATS`) and would delete everything beyond that, and it knows nothing of `live` or
   `deleted_at`.
4. The privacy policy needs the sentence about the 30-day purge (see the owner decisions above).

## Left alone on purpose (for later)

- `GET /chats` has no pagination beyond 100.
- Pre-existing: a `POST /chat` claim can land between `_busy()` and the session reset (the version check does not see a
  turn that has started but not finished). It is not made worse; it is not fixed here.
- The old panel's `DELETE /tutor/chats/{id}` is still a hard delete of any row, the live one included (the live row is
  recreated from the session on the next read, so no conversation is lost).
- The export lists the live chat's row with an empty message copy (its messages are in the Tutor session).
- Two tabs that start a chat at the same moment can, in a very narrow window, leave one of them holding the id of a
  chat the other just archived or deleted. Nothing is lost, saved twice or hidden; that tab gets a 404 or a 409 on its
  next call and refetches. A transaction in the database (one function for the whole change) would close it fully.
