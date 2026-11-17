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

No new table. Four columns and two indexes on `tutor_chats`:

| Column | Meaning |
| --- | --- |
| `class_id` | the class (`folders.id`) the chat belongs to, null = none; `on delete set null` |
| `renamed` | true once the student typed a title; until then the title is the first message |
| `live` | this row is the Tutor's current conversation (at most one per student, partial unique index) |
| `deleted_at` | soft delete; Undo clears it; the backend purges rows 30 days after deletion |

`updated_at` stays the last activity; renaming or moving does not change it. While a chat is live its
messages are read from `tutor_sessions` (the row keeps a copy only when the conversation moves on), so
nothing is stored twice and the extension-shared session stays the single source of truth.
RLS is on with no client policy and no client grant, the same as `tutor_chats` and `tutor_sessions`: the
owner check is in the endpoints, and every query also filters on `user_id`.
The migration backfills `class_id` for existing chats that are about a guide (the guide's class).

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
409 the Tutor is working, or the conversation moved on; refresh and retry.

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
- The 30-saved-chat cap in `start_tutor_chat` (the pre-migration path) still deletes the oldest chats beyond 30.
  After the migration the new path does not prune; only deleted chats are purged (30 days). The owner may want
  a retention rule for saved chats.
- `account_export` still exports every row (including deleted ones); `memory_context` now skips deleted chats.
- `tests/qa/mock-api.cjs` has no `/chats` routes; the UI task adds them.
