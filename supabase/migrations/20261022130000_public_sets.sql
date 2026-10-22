-- Public sets (NOT APPLIED: waiting for the owner's OK).
--
-- Today a guide can be shared with its class (shared_sets, visibility 'class'): a snapshot of the
-- title, guide text and cards that classmates study or save a copy of. This lets a student make
-- the snapshot public too, so anyone can find it by search, study it, and save their own copy
-- (Quizlet-style). Only the snapshot is ever public: never notes, chats, progress or files.
--
-- 1. 'public' visibility, and no class needed for it (a guide that isn't in a class can go public).
-- 2. A subject the owner picks, and full-text search over the title, subject and cards.
-- 3. A saves count for ranking.
-- 4. Signed-out visitors read nothing directly: public pages are served by the backend (service
--    role), which only returns visible, public snapshots. Signed-in readers can also read public
--    snapshots alongside their own and their classes'.

alter table public.shared_sets drop constraint if exists shared_sets_visibility_check;
alter table public.shared_sets add constraint shared_sets_visibility_check check (visibility in ('private', 'class', 'public'));
alter table public.shared_sets alter column class_id drop not null;
alter table public.shared_sets add constraint shared_sets_class_unless_public check (class_id is not null or visibility <> 'class');

alter table public.shared_sets add column if not exists subject text check (char_length(subject) <= 80);
alter table public.shared_sets add column if not exists saves integer not null default 0;
alter table public.shared_sets add column if not exists published_at timestamptz;
alter table public.shared_sets add column if not exists search tsvector generated always as (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(subject, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(study_guide, '')), 'C')
) stored;

create index if not exists shared_sets_public_search_idx on public.shared_sets using gin (search)
  where visibility = 'public' and status = 'visible';
create index if not exists shared_sets_public_rank_idx on public.shared_sets (saves desc, published_at desc)
  where visibility = 'public' and status = 'visible';

drop policy if exists "Owners and class members read shared sets" on public.shared_sets;
create policy "Owners and class members read shared sets" on public.shared_sets for select to authenticated using (
  owner_id = auth.uid()
  or (visibility = 'public' and status = 'visible')
  or (visibility = 'class' and status = 'visible' and public.is_class_member(class_id))
);
