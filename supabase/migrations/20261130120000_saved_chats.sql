-- NOT APPLIED: waiting for owner's OK. Run after 20261021130000_tutor_chats.sql (already live).
-- Redesign T5, saved chats: every Tutor conversation becomes a chat with its own id (the URL
-- /chat/[id]), a title, an optional class, and a delete the student can undo.
--
-- This adds four columns and two indexes to public.tutor_chats, the table that already holds the
-- student's saved Tutor chats (per guide, or general). No second store, nothing copied:
--   class_id    the class (folder) the chat belongs to; null = in no class. Deleting the class
--               un-files its chats, it never deletes them.
--   renamed     true once the student typed a title. Until then the title is the first message.
--   live        the one chat that is the Tutor's current conversation. While a chat is live its
--               messages stay in public.tutor_sessions (the row the web app and the extension
--               share) and the backend reads them from there; the chat row keeps the id, title and
--               class, and takes a copy of the messages when the conversation moves on.
--   deleted_at  soft delete: set by Delete, cleared by Undo. The backend removes the row for good
--               30 days later.
-- updated_at (already there) stays the chat's last activity. Renaming or moving does not touch it.
--
-- Existing chats keep their id, title, messages and times. The backfill below only files a chat
-- that is about a guide under that guide's class, so the class page's Chats tab is not empty for
-- history. It runs once (class_id is null) and is safe to run again.
--
-- Only the backend (service role) reads or writes this table; the owner check is in the endpoints
-- (GET/PATCH/DELETE /chats...). Row-level security is switched on with no client policy and the
-- client roles have no grant, exactly as for tutor_chats and tutor_sessions. A student can never
-- read another student's chat, and cannot read their own except through the backend.
--
-- Before this runs the backend answers every /chats endpoint without an error: the list falls back
-- to the Tutor chats that already exist, and rename, move, delete and undo say "not available yet".

alter table public.tutor_chats
  add column if not exists class_id uuid references public.folders(id) on delete set null,
  add column if not exists renamed boolean not null default false,
  add column if not exists live boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- At most one live chat per student (the Tutor has one current conversation).
create unique index if not exists tutor_chats_one_live_per_user
  on public.tutor_chats (user_id) where live;

-- A class page's Chats tab, and Recent chats: this student's chats that are not deleted, newest first.
create index if not exists tutor_chats_user_class_updated
  on public.tutor_chats (user_id, class_id, updated_at desc) where deleted_at is null;

-- History about a guide belongs to that guide's class.
update public.tutor_chats c
   set class_id = g.folder_id
  from public.study_guides g
 where c.guide_id = g.id
   and g.folder_id is not null
   and c.class_id is null;

alter table public.tutor_chats enable row level security;
revoke all on table public.tutor_chats from public, anon, authenticated;
grant select, insert, update, delete on table public.tutor_chats to service_role;
