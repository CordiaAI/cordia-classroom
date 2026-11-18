-- NOT APPLIED: waiting for owner's OK. Run after 20261021130000_tutor_chats.sql (already live).
-- Redesign T5, saved chats: every Tutor conversation becomes a chat with its own id (the URL
-- /chat/[id]), a title, an optional class, and a delete the student can undo.
--
-- How to apply: this file carries its own begin; ... commit; and is applied as ONE script (paste the
-- whole file into the SQL editor and run it once, or psql -f). Do not run parts of it. It applies
-- completely or not at all, and it gives up after 5 seconds instead of queueing behind a long lock
-- (set local lock_timeout): if that happens nothing changed, run it again at a quieter moment.
--
-- This adds three columns and three indexes to public.tutor_chats, the table that already holds the
-- student's saved Tutor chats (per guide, or general), and one column and one index to
-- public.tutor_sessions. No second store, nothing copied:
--   tutor_chats.class_id    the class (folder) the chat belongs to; null = in no class. Deleting the
--                           class un-files its chats, it never deletes them.
--   tutor_chats.renamed     true once the student typed a title. Until then the title is the first message.
--   tutor_chats.deleted_at  soft delete: set by Delete, cleared by Undo. The backend removes the row for
--                           good 30 days later (a daily job in the sync worker, and when the student next
--                           starts a chat).
--   tutor_sessions.live_chat_id  which chat the Tutor's current conversation is. It is the single record
--                           of the live chat: the backend writes it in the same row update as the
--                           conversation itself, so the messages and the chat they belong to can never
--                           disagree. While a chat is live its messages stay in tutor_sessions (the row
--                           the web app and the extension share); its tutor_chats row keeps the id, title
--                           and class, and a copy of the messages taken before the conversation moves on.
--                           Null = the conversation has no chat yet (everything from before this; the
--                           backend gives it one the first time it is listed or moved on). No backfill.
--                           Removing a chat row sets it back to null (on delete set null); the
--                           conversation itself is in tutor_sessions and stays.
-- updated_at (already there) stays the chat's last activity. Renaming or moving does not touch it.
--
-- Existing chats keep their id, title, messages and times. The backfill below files a chat that is
-- about a guide under that guide's class (only when the guide and the class are the chat's owner's),
-- so the class page's Chats tab is not empty for history. It lives inside the block that adds
-- class_id, so it runs only the first time the file is applied. Running the file again after launch
-- changes nothing and never re-files a chat a student moved out of a class.
--
-- Only the backend (service role) reads or writes these tables; the owner check is in the endpoints
-- (GET/PATCH/DELETE /chats...). Row-level security is switched on with no client policy and the
-- client roles have no grant, exactly as before. A student can never read another student's chat,
-- and cannot read their own except through the backend.
--
-- Before this runs the backend answers every /chats endpoint without an error: the list falls back
-- to the Tutor chats that already exist, and rename, move, delete and undo say "not available yet".
-- Once it has run, never roll the backend back to an older release: the old code trims saved chats to
-- the newest 30 and would delete chats past that, and it knows nothing of live_chat_id.

begin;

set local lock_timeout = '5s';

alter table public.tutor_chats
  add column if not exists renamed boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- class_id and its backfill go together, once: the backfill runs only if this file is the one that
-- creates the column.
do $saved_chats$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tutor_chats' and column_name = 'class_id'
  ) then
    alter table public.tutor_chats
      add column class_id uuid references public.folders(id) on delete set null;

    -- History about a guide belongs to that guide's class. A guide can carry a folder id that is not
    -- its owner's, so the guide must be the chat owner's and the folder the chat owner's too.
    update public.tutor_chats c
       set class_id = g.folder_id
      from public.study_guides g
     where c.guide_id = g.id
       and g.user_id = c.user_id
       and g.folder_id is not null
       and exists (select 1 from public.folders f where f.id = g.folder_id and f.user_id = c.user_id);
  end if;
end
$saved_chats$;

-- The one record of which chat is live (nullable, no backfill).
alter table public.tutor_sessions
  add column if not exists live_chat_id uuid references public.tutor_chats(id) on delete set null;

-- Removing a chat row (the purge, a hard delete) looks up the session that points at it; the purge
-- also asks which of its candidates a session points at, to leave those alone.
create index if not exists tutor_sessions_live_chat_id
  on public.tutor_sessions (live_chat_id) where live_chat_id is not null;

-- A class page's Chats tab, and Recent chats: this student's chats that are not deleted, newest first.
create index if not exists tutor_chats_user_class_updated
  on public.tutor_chats (user_id, class_id, updated_at desc) where deleted_at is null;

-- Deleting a class sets class_id to null on its chats (on delete set null); without an index that
-- starts with class_id, every class delete would scan the whole table.
create index if not exists tutor_chats_class_id
  on public.tutor_chats (class_id) where class_id is not null;

-- The daily purge looks for deleted chats past their 30 days, across students.
create index if not exists tutor_chats_deleted_at
  on public.tutor_chats (deleted_at) where deleted_at is not null;

alter table public.tutor_chats enable row level security;
revoke all on table public.tutor_chats from public, anon, authenticated;
grant select, insert, update, delete on table public.tutor_chats to service_role;

commit;
