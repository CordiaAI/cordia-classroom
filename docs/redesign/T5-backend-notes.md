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

No new table. One transaction (`begin; set local lock_timeout = '5s'; ... commit;`):

| Table.column | Meaning |
| --- | --- |
| `tutor_chats.class_id` | the class (`folders.id`) the chat belongs to, null = none; `on delete set null` |
| `tutor_chats.renamed` | true once the student typed a title; until then the title is the first message |
| `tutor_chats.deleted_at` | soft delete; Undo clears it; deleted chats are removed for good 30 days after deletion (daily job, see below) |
| `tutor_sessions.live_chat_id` | **the single record of which chat is live**: the chat the session's messages belong to. Nullable, no backfill, `references tutor_chats(id) on delete set null` |

There is **no `tutor_chats.live` column** (an earlier draft had one, with a one-live-per-student index and a
"not live and deleted" check). It was dropped instead of kept as a mirror: a mirror is a second record that can
disagree with the session, and every bug the two reviews found came from two records disagreeing for a moment.
With one record there is nothing to tidy and nothing to heal.

Indexes: `tutor_sessions (live_chat_id) where live_chat_id is not null` (removing a chat row looks up the session that
points at it; the purge asks which candidates a session points at); `tutor_chats (user_id, class_id, updated_at desc)
where deleted_at is null` for the lists; `tutor_chats (class_id) where class_id is not null` so deleting a class does not
scan the table; `tutor_chats (deleted_at) where deleted_at is not null` for the purge.

`updated_at` stays the last activity; renaming or moving does not change it. While a chat is live its messages are read
from `tutor_sessions`; its `tutor_chats` row keeps the id, title and class, and a copy of the messages that is only ever a
snapshot of what the session already holds (written just before the conversation moves on).
RLS is on with no client policy and no client grant, the same as before: the owner check is in the endpoints, and every
query also filters on `user_id`. The migration backfills `class_id` for existing chats that are about a guide (the guide's
class), only when the guide and the class are the chat owner's own, inside the block that adds `class_id`, so it runs only
the first time the file is applied. The backend applies the same ownership rule (`saved_chats._guide_classes`).

## Which chat is live: one answer everywhere

"Is chat X live" means: `tutor_sessions.live_chat_id = X` **and** X exists and is not deleted. A pointer at a deleted or
missing chat counts as "no live chat". Every reader derives it the same way: `GET /chats` and `GET /chats/{id}`
(`saved_chats._is_live`), delete (`_snapshot`), the purge (`_pointed_at`: never removes a chat a session points at, even
one with an old `deleted_at`), the old panel's `GET /tutor/chats` (`tutor_sessions.list_tutor_chats` leaves out the
pointed-at chat and deleted chats). No chat can be "live and deleted" because "live" is defined as pointed at and not
deleted.

A conversation with messages and no usable chat (everything from before the migration, or a session left pointing at a
chat that was deleted or hard-deleted) gets a chat the first time anything reads it (`_home`): an **empty** new row,
then `live_chat_id` set by a compare-and-set that only applies while the pointer is still what was read. The messages
stay in the session, so nothing is copied and nothing can be lost; if another request gave it a row first, this
request's row is removed again (only its own, only while still empty and unused). A read never creates a second row for
a conversation that has one.

## The order of writes (`backend/services/saved_chats.py`)

Every request that changes which chat is live (new chat, open, delete of the live chat, the old panel's
`POST /tutor/session/new` new and resume) follows the same four steps, so a crash or another tab can at worst leave a
**duplicate, never a gap**:

1. **Read** (`_snapshot`, `_settled`): the session row once (messages, `conversation_version`, `updated_at`, `status`,
   `run_id`, `live_chat_id`), and the row the pointer names, read *before* that session read. If the conversation has
   messages and no usable row, `_home` gives it one first and the read is repeated.
2. **Save** (`_save`): the session's messages are written into the live chat's row. Only `messages` and `updated_at`
   (never `title`, `renamed` or `class_id`, so a rename or move in another tab survives); only while the row is not
   deleted; only while the row's `updated_at` is still what was read (so a slower request never writes an older copy over
   a newer one). An empty conversation saves nothing. *Safe on a crash:* the session is untouched. *Safe against another
   tab:* it is only a snapshot of what the session already holds; if this request then loses the race, the live chat's
   row simply holds an up-to-date copy.
3. **Reset** (`_reset`), the one atomic step: one `update` of the session row with
   `conversation_version = v and updated_at = u and status = s and run_id = r and live_chat_id = p` (all as read) that
   writes the new messages (empty, or the opened chat's saved messages), the new `live_chat_id`, version + 1, an idle
   status, a cleared goal and run. *Which field stops a message being dropped:* `updated_at`. `conversation_version`
   only changes when a turn completes; a turn's claim, a failed turn (which keeps the student's message) and a reply
   posted outside a turn (`append_tutor_message`) do not change it, but every write that touches `messages` writes
   `updated_at`, so a message sent after the read makes the compare-and-set change no row. `status` and `run_id` also
   refuse a turn that is in flight (a request that sees a turn in flight answers 409 before it writes anything).
   If no row changed, another request won: the request reads again and decides again (up to 3 times), then 409.
4. **Tidy**, only after the reset went through: the chat that was live is removed if it is empty, never renamed, not
   saved into since it was read and the session does not point at it again (`_tidy`, `_discard`); the student's old
   deleted chats are purged. Failures are only logged.

Per route:

| Request | Steps |
| --- | --- |
| New chat (`POST /chats`, panel `POST /tutor/session/new` without `resume_id`) | `_start_new`: read; insert an empty, not-live row of its own; save; reset to empty with `live_chat_id` = the new row; tidy. If the reset loses, the request reads again; if it gives up, it removes only its own still-empty row and answers 409. It never adopts or edits a row another request made. |
| Open (`POST /chats/{id}/open`, panel resume) | `_start_open`: read; save; read the chat being opened (right before the reset); reset to its saved messages with `live_chat_id` = it; read it again: if another tab deleted it in between, the session (which holds exactly that chat's saved copy, checked by the same compare-and-set) is emptied and the answer is 404. |
| Delete the live chat (`DELETE /chats/{id}`) | `delete_chat`: read; save into it; reset to empty with `live_chat_id = null`; then mark it deleted (`_mark_deleted`). A crash between the reset and the mark leaves it a saved, not-deleted chat holding the conversation; the student can delete it again. |
| Delete another chat | `_mark_deleted`: mark it deleted, then read the session; if another tab made it live meanwhile, take the mark back and answer 409. |
| Rename, move | one `update` of `title`/`renamed` or `class_id` on that row, not deleted; nothing else writes those columns. |

There is no "put back" step anywhere: nothing ever writes old messages over a session. If a step after the save fails,
the saved copy is the safety and the session is left as it is.

The pre-migration path (`tutor_sessions.start_tutor_chat`) already saved first (insert the copy, then reset); it is
unchanged.

## How existing history becomes chats

- Saved chats keep their id, title, messages and times. After the migration they simply gain the new columns.
- A conversation that is in `tutor_sessions` with no pointer (everything from before this) gets an empty row and the
  pointer the first time `GET /chats`, `GET /chats/{id}` or a change of the live chat sees it (see above).
- `GET /tutor/chats` (the Tutor panel's Past chats) is unchanged in shape; after the migration it leaves out the live
  chat and deleted chats, and gives a chat saved without a title its first question as the title (empty, unused chats are
  not listed). `POST /tutor/session/new` is unchanged in shape and now keeps the saved chat's row (and so its id, title
  and class) when it is resumed.

## Endpoints (`backend/routers/chats.py`, prefix `/chats`, signed-in student only)

Chat summary: `{id, title, guide_id, class_id, live, created_at, updated_at}`.
`editable` is false until the migration has run. No existing response gained a field (`live_chat_id` is never sent).

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
409 the Tutor is working, or another tab changed the conversation first. No route answers 500 for a race, and none
answers 500 before the migration.

## Stale tabs: every 404 and 409 another tab can cause

| Route | Answer | When |
| --- | --- | --- |
| `POST /chats`, panel `POST /tutor/session/new` | 409 "Wait for Cordia Tutor to finish..." | a message is being answered (in any tab) |
| same | 409 "Tutor conversation changed. Refresh and try again." | other tabs changed the conversation three times while this request ran |
| same | 404 "Class not found" / "Guide not found" | the class or guide was deleted in another tab |
| `POST /chats/{id}/open`, panel resume | 404 "Chat not found" | the chat was deleted (or removed by the old panel) in another tab before the switch |
| same | 404 "That chat was deleted in another tab." | it was deleted in the moment of the switch; the Tutor is left empty (the previous chat was saved) |
| same | 409 busy / 409 changed | as for `POST /chats` |
| `DELETE /chats/{id}` | 404 "That chat is already gone." | already deleted in another tab, or an empty chat nobody used that a new chat in another tab removed |
| same | 409 "Wait for Cordia Tutor to finish before deleting this chat" | it is the live chat and a message is being answered |
| same | 409 changed | another tab opened this chat at the same moment (the delete is taken back), or kept changing the conversation |
| `PATCH /chats/{id}`, `GET /chats/{id}` | 404 | deleted in another tab, or an empty unused chat removed by a new chat |
| `POST /chats/{id}/restore` | 404 | already removed for good (purged after 30 days, or the old panel's hard delete) |
| `POST /chat` (unchanged) | 409 "Tutor conversation changed" | the tab's `conversation_version` is older than the session's (another tab switched chats) |

**What the web app should do:** on any of these, refresh the chat list (`GET /chats`) and the current chat
(`GET /chats/{id}` or `GET /tutor/session`), and say in plain words that the chat was deleted or moved in another tab
(or, for "busy", that the Tutor is still answering). Never show the raw error and never a blank screen: on a 404 for the
chat in the URL, go back to the list (or the new live chat). Nothing is lost in any of these cases; the student's
messages are in the session or in a chat they can list.

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
- Detection: `tutor_sessions.is_missing_saved_chats_schema` matches the error code (`42703` from Postgres on a select or
  filter, `PGRST204` from PostgREST on an insert or update, `PGRST205`/`42P01` for a missing table) together with one of
  the new column names as a whole word (`deleted_at`, `class_id`, `renamed`, `live_chat_id`). Right after the migration,
  while PostgREST's schema cache may still be the old one, a write naming a new column is refused with `PGRST204`: new
  and open then use the old path (their first write always names a new column, so nothing of the new path was written),
  rename, move, delete and undo answer the 503 above, and lists and reads keep working.

## What the UI builder needs to know

- **Send messages as today**: `POST /chat` with `session_id`, `conversation_version` and `class_id` set to the
  chat's `class_id`. For a chat that is not live, call `POST /chats/{id}/open` first (one live chat at a time).
  A reload of `/chat/[id]` is `GET /chats/{id}`; if `live` is true use its `session_id` and
  `conversation_version`.
- New endpoints answer 404 on the backend that is live now (not deployed). Fall back to `GET /tutor/chats`
  and the existing session calls when `/chats` returns no `chats` array.
- A deleted live chat becomes a saved, deleted chat and the Tutor is empty. Undo returns it as saved, not live.
- Starting a chat while the current one is empty and was never used (no messages, never renamed) removes that empty chat
  and starts a new one; an empty chat the student renamed is kept.
- **Two tabs**: see "Stale tabs" above. On a 409 or 404, refetch and show what is current.
- The 30-saved-chat cap in `start_tutor_chat` (the pre-migration path) still deletes the oldest chats beyond 30.
  After the migration the new path does not prune; only deleted chats are purged (30 days). See the owner's
  decisions below.
- `account_export` still exports every row, including deleted ones, which now carry a deleted marker (below);
  `memory_context` skips deleted chats, and falls back to the old columns only when the error says the new column is
  missing (any other error is logged and the Tutor chats are left out of that one answer).
- `tests/qa/mock-api.cjs` has no `/chats` routes; the UI task adds them.

## Owner decisions (Jude)

1. **No trim to the newest 30 saved chats after the migration.** Approved. Already how the code works:
   `saved_chats.start_chat` never prunes saved chats (`list_chats` shows 30 per page by default, up to 100, and
   deletes nothing). Only the pre-migration path, `tutor_sessions.start_tutor_chat` (`MAX_SAVED_CHATS`), trims, and
   it stops being used once the migration is applied.
2. **Deleted chats are purged 30 days after deletion.** Approved. The 30 is one named constant, `DELETED_KEEP_DAYS` in
   `backend/services/saved_chats.py`; the purge and the account export both read it. The purge runs daily for every
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
4. **Save first, reset after** (the rule behind the third pass): if resetting the session before writing the chat rows
   can lose any messages on a crash or deploy, that is High; the order is save first, reset after, so the worst case is
   a duplicate, never a gap. The session row is the single record of which chat is live. No database function.

**For the pull request description:** it must say that the privacy policy needs a sentence saying deleted chats are
purged 30 days after deletion (and that the data export includes them, marked deleted, until then).

## Review history

- **First review** (H1, M1, M2): a chat could be live and deleted; overlapping starts gave 500s or saved twice; a guide's
  folder was trusted as the chat's class. The second pass fixed these by resetting the session first, then writing the
  chat rows, with a database check and a put-back step.
- **Second review** (H-A, H-B, both High): resetting first opened a window in which the session already held the new
  conversation while the old chat row was still marked live, so another tab could file a chat's messages under the wrong
  chat (H-A, open plus delete of the live chat: the opened chat's messages ended up only inside a deleted chat and were
  purged 31 days later), and a crash between the reset and the row write lost the conversation (H-B). The put-back could
  also overwrite a turn another tab had started.
- **Third pass (this one)**: the order is now save first, reset after (above), and `live_chat_id` on the session replaces
  `tutor_chats.live`, so the session's messages and the chat they belong to are written in one row update and can never
  disagree. The put-back is gone. Also: the save writes messages and time only (the rename that was lost), `_fresh_live`'s
  "settle on another request's live chat" is gone (no request edits a row it did not create except the guarded save and
  the guarded removal of an unused empty chat), the purge deletes with a count instead of returning rows and never removes
  a chat a session points at, `memory_context` falls back only on the missing-column error, and the migration sets a
  lock timeout. `append_tutor_message` (practice feedback posted into the Tutor) now writes only onto the conversation it
  read (compare-and-set on `updated_at`), so it can never write an old conversation over a chat another tab opened.

Tests (`tests/test_saved_chats.py`; the fake database enforces the foreign key and its `on delete set null`, and can run
another request at an exact step of this one):

| What | Test |
| --- | --- |
| Every ordered pair of 13 actions (new via `/chats` and via the panel, open R, open T, open the live chat, delete the live chat, delete R, restore, list, get the live chat, rename, move, a full message turn), tab B's whole request before every database call of tab A's, from a normal live chat, a conversation with no row yet, and an empty live chat; invariants: no 5xx, no live-and-deleted chat, one answer to "which chat is live" in the list, a single chat and the old panel, every message reachable exactly once (or only in a chat the student deleted), no chat holding another's messages, titles/classes/renamed changed only by a rename or move, then a follow-up turn and new chat saved once | `Interleavings.test_every_pair_from_*` |
| A turn claimed before every database call of every change and completed after it | `Interleavings.test_a_turn_in_flight_across_every_step_of_every_change` |
| A crash, a lost answer, or two failed database calls in a row at every database call of new chat, panel new, open and delete-live; nothing lost and the next request consistent | `CrashTests.test_a_crash_or_a_lost_answer_at_any_step_never_loses_a_message`, `test_probe_1..4` |
| H-A end to end (normal, empty and no-row live chat, both orders), through the purge 31 days later | `TwoTabTests.test_h_a_*` |
| A turn another tab started is never overwritten (probe_after_reset [5], [6]); a message sent between the save and the reset is never dropped; an older copy never saved over a newer one | `TwoTabTests.test_a_turn_started_*`, `test_a_failed_delete_*`, `test_a_message_sent_*`, `test_a_slower_request_*` |
| The settle hijack, the lost rename, the duplicate cases | `TwoTabTests.test_a_new_chat_never_changes_*`, `test_a_rename_in_another_tab_*`, `test_overlapping_starts_*`, `test_two_tabs_starting_*` |
| The purge never removes the chat a session points at, even with an old `deleted_at` | `CrashTests.test_the_purge_never_removes_*`, `PurgeJobTests` |
| Before the migration; right after it with a stale schema cache; the matcher for `live_chat_id` | `BeforeMigrationTests`, `StaleSchemaCacheTests`, `MissingSchemaMatcherTests` |

## The daily purge

Deleted chats are removed for good by a job in the **existing background sync worker** (`backend/services/sync_worker.py`,
the thread started on Fly at app start; no second worker, no new scheduler).

- **What triggers it.** The worker loop wakes once a minute; `saved_chats.run_purge_if_due()` runs on the first pass at
  or after 09:00 UTC each day (about 4 a.m. US Eastern) and not again that day, the same pattern as the nightly decision
  outcomes. After a database error it tries again an hour later, not every minute. A restart of the machine can repeat a
  run the same day; that is harmless.
- **What it can remove.** `deleted_at is not null and deleted_at < (now in UTC - DELETED_KEEP_DAYS days)`, and no Tutor
  session points at it (`live_chat_id`). `_purge_batches` holds that rule and both the job and the purge on a student's
  next chat use it, with the one constant. A row with `deleted_at` null is never touched. It picks up to 100 ids with the
  filter, leaves out any a session points at, then deletes those ids with the same filter again (asking for a count, not
  the rows), at most 100 batches (10,000 chats) per run; the rest goes the next day.
- **Safe.** Running it twice removes nothing the second time; two machines at once just delete overlapping batches.
  Before the migration (no `deleted_at` column) it removes nothing and logs one line; any other database error is
  logged and does not stop the worker's other jobs. The log says how many chats it removed, never titles or messages.
- **Not live yet.** The job runs only after the owner deploys the backend (`cd backend && fly deploy`) and applies the
  migration. Until then deleted chats are still only purged when their student starts a chat, which is why the privacy
  policy line ("deleted chats are purged 30 days after deletion") is not yet true for students who never come back.
- **Wording.** The job runs once a day, so a chat becomes eligible at some hour on its `purge_on` date and is removed at
  the next run, at most a day later. The export note says "permanently deleted on `purge_on` ... within a day of that
  date".

## The owner's checklist for applying the migration

1. Run these read-only checks on the live database; **both should return 0**. (A non-zero result means a guide or a
   folder is attached to another student's chat; the backfill ignores those, but ask before applying.)
   ```sql
   select count(*) from tutor_chats c join study_guides g on g.id = c.guide_id where g.user_id is distinct from c.user_id;
   select count(*) from tutor_chats c join study_guides g on g.id = c.guide_id join folders f on f.id = g.folder_id where f.user_id is distinct from c.user_id;
   ```
2. Deploy the backend first (`cd backend && fly deploy`), check `cd backend && fly logs` for errors, and only then apply
   the migration. The backend works before and after it.
3. Apply the file as **one script** (paste the whole file into the SQL editor and run it once, or `psql -f`). It carries
   its own `begin; ... commit;`; do not run parts of it. If it stops with a lock timeout (it waits at most 5 seconds for
   `tutor_chats` and `tutor_sessions`), nothing changed: run it again at a quieter moment.
4. After it: `GET /chats` should answer with `editable: true`; rename, move, delete and undo stop answering 503. Watch
   `fly logs` for a minute: a `PGRST204` right after the migration (PostgREST's schema cache reloading) is handled by
   the fallback and stops on its own; if it does not, reload the schema cache (`notify pgrst, 'reload schema';`).
5. **Never roll the backend back to an older release after the migration is applied.** The old code trims saved chats to
   the newest 30 (`MAX_SAVED_CHATS`) and would delete everything beyond that, and it knows nothing of `live_chat_id`
   or `deleted_at`.
6. The privacy policy needs the sentence about the 30-day purge (see the owner decisions above).

## Left alone on purpose (for later)

- `GET /chats` has no pagination beyond 100.
- The old panel's `DELETE /tutor/chats/{id}` is still a hard delete of any row (after the migration it only lists
  chats that are not live). If it removes the live chat's row, `on delete set null` clears the pointer and the
  conversation stays in the session; the next read gives it a chat of its own. Nothing is lost.
- The export lists the live chat's row with the message copy it had when it was last saved (its current messages are in
  the Tutor session, which the export also includes).
- An abandoned turn (running for more than 3 minutes) does not block a change of the live chat, as before: the change
  saves the student's question and resets the session, and the abandoned turn's late answer is refused (409).
- In the few seconds after the migration while PostgREST's schema cache is stale, new and open use the old path,
  including its 30-chat trim; no chat has been soft-deleted or pointed at yet in that window, so it behaves exactly as
  today.
