-- NOT APPLIED: waiting for owner's OK. Run after 20261021130000_tutor_chats.sql (already live).
-- Redesign T5, saved chats: every Tutor conversation becomes a chat with its own id (the URL
-- /chat/[id]), a title, an optional class, and a delete the student can undo.
--
-- This adds four columns, a check and four indexes to public.tutor_chats, the table that already
-- holds the student's saved Tutor chats (per guide, or general). No second store, nothing copied:
--   class_id    the class (folder) the chat belongs to; null = in no class. Deleting the class
--               un-files its chats, it never deletes them.
--   renamed     true once the student typed a title. Until then the title is the first message.
--   live        the one chat that is the Tutor's current conversation. While a chat is live its
--               messages stay in public.tutor_sessions (the row the web app and the extension
--               share) and the backend reads them from there; the chat row keeps the id, title and
--               class, and takes a copy of the messages when the conversation moves on.
--   deleted_at  soft delete: set by Delete, cleared by Undo. The backend removes the row for good
--               30 days later (a daily job in the sync worker, and when the student next starts a chat).
-- updated_at (already there) stays the chat's last activity. Renaming or moving does not touch it.
--
-- A chat is never live and deleted at once: tutor_chats_live_not_deleted makes the database refuse it,
-- so two requests racing (two tabs) fail with an error the backend answers as a conflict (409) instead
-- of leaving the student talking into a deleted chat.
--
-- The whole file is one transaction: it applies completely or not at all.
--
-- Existing chats keep their id, title, messages and times. The backfill below files a chat that is
-- about a guide under that guide's class (only when the guide and the class are the chat's owner's),
-- so the class page's Chats tab is not empty for history. It lives inside the block that adds
-- class_id, so it runs only the first time the file is applied. Running the file again after launch
-- changes nothing and never re-files a chat a student moved out of a class.
--
-- Only the backend (service role) reads or writes this table; the owner check is in the endpoints
-- (GET/PATCH/DELETE /chats...). Row-level security is switched on with no client policy and the
-- client roles have no grant, exactly as for tutor_chats and tutor_sessions. A student can never
-- read another student's chat, and cannot read their own except through the backend.
--
-- Before this runs the backend answers every /chats endpoint without an error: the list falls back
-- to the Tutor chats that already exist, and rename, move, delete and undo say "not available yet".
-- Once it has run, never roll the backend back to an older release: the old code trims saved chats to
-- the newest 30 and would delete chats past that.

begin;

alter table public.tutor_chats
  add column if not exists renamed boolean not null default false,
  add column if not exists live boolean not null default false,
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

-- A chat is never both the live conversation and deleted.
alter table public.tutor_chats drop constraint if exists tutor_chats_live_not_deleted;
alter table public.tutor_chats
  add constraint tutor_chats_live_not_deleted check (not (live and deleted_at is not null));

-- At most one live chat per student (the Tutor has one current conversation).
create unique index if not exists tutor_chats_one_live_per_user
  on public.tutor_chats (user_id) where live;

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
