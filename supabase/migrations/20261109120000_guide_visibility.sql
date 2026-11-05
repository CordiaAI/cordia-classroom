-- NOT APPLIED: waiting for owner's OK. Run after 20261108120000_social_graph.sql, then
-- 20261109130000_guide_visibility_backfill.sql (the data step, kept separate).
--
-- Social plan, Stage 3: who can see a guide, saving other people's guides, and copies.
--
-- 1. study_guides.visibility (private / link / classroom / public). The database default stays
--    private; the backend decides what a new guide starts as. 'classroom' means "people in my
--    class": today the guide's course (Class sets), and from Stage 5 the classrooms it's added to.
--    attribution: 'named' shows the author's username, 'anonymous' never reveals them.
-- 2. study_guides.version goes up when the title, outline, questions or cards change, so a saver
--    can pin a version and a copy records which one it came from (forked_from_*).
-- 3. study_guides.review_status: 'held' while a report or the leak check is reviewed (hidden from
--    everyone but the owner), 'hidden' when an admin keeps it down. hold_reason says why.
-- 4. guide_saves: other people's guides you saved, with the version you saw.
-- 5. user_profiles.honor_code_accepted_at: set the first time someone publishes (public or link).
-- 6. copyright_takedowns.guide_id: a report can name a guide page (/sets/<id>), not only a class set.
-- Nothing here is readable from the browser beyond what already was: other people's guides are
-- served by the backend, which checks visibility, blocks, holds and instructor opt-outs itself.

do $$ begin
  create type public.guide_visibility as enum ('public', 'link', 'classroom', 'private');
exception when duplicate_object then null;
end $$;

alter table public.study_guides
  add column if not exists visibility public.guide_visibility not null default 'private',
  add column if not exists attribution text not null default 'named',
  add column if not exists forked_from_guide_id uuid references public.study_guides on delete set null,
  add column if not exists forked_from_version integer,
  add column if not exists version integer not null default 1,
  add column if not exists review_status text not null default 'ok',
  add column if not exists hold_reason text,
  add column if not exists visibility_migrated boolean not null default false;

alter table public.study_guides drop constraint if exists study_guides_attribution_check;
alter table public.study_guides add constraint study_guides_attribution_check check (attribution in ('named', 'anonymous'));
alter table public.study_guides drop constraint if exists study_guides_review_status_check;
alter table public.study_guides add constraint study_guides_review_status_check check (review_status in ('ok', 'held', 'hidden'));
alter table public.study_guides drop constraint if exists study_guides_version_check;
alter table public.study_guides add constraint study_guides_version_check check (version >= 1);
alter table public.study_guides drop constraint if exists study_guides_hold_reason_length;
alter table public.study_guides add constraint study_guides_hold_reason_length check (hold_reason is null or char_length(hold_reason) <= 300);

create index if not exists study_guides_visible_idx on public.study_guides (user_id, visibility) where visibility in ('public', 'link');
create index if not exists study_guides_forked_from_idx on public.study_guides (forked_from_guide_id) where forked_from_guide_id is not null;
create index if not exists study_guides_review_idx on public.study_guides (review_status) where review_status <> 'ok';

create table if not exists public.guide_saves (
  user_id uuid not null references auth.users on delete cascade,
  guide_id uuid not null references public.study_guides on delete cascade,
  pinned_version integer,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
create index if not exists guide_saves_guide_idx on public.guide_saves (guide_id);
alter table public.guide_saves enable row level security;
revoke all on public.guide_saves from anon, authenticated;
grant select, insert, update, delete on public.guide_saves to service_role;

alter table public.user_profiles add column if not exists honor_code_accepted_at timestamptz;

alter table public.copyright_takedowns add column if not exists guide_id uuid references public.study_guides on delete set null;

-- Check afterwards:
--   select column_name from information_schema.columns where table_name = 'study_guides'
--     and column_name in ('visibility','attribution','forked_from_guide_id','forked_from_version','version',
--                         'review_status','hold_reason','visibility_migrated');                    -- 8 rows
--   select to_regclass('public.guide_saves');                                                       -- set
--   select has_table_privilege('authenticated', 'public.guide_saves', 'SELECT');                    -- false

-- Rollback (run the backfill's rollback first):
-- alter table public.copyright_takedowns drop column if exists guide_id;
-- alter table public.user_profiles drop column if exists honor_code_accepted_at;
-- drop table if exists public.guide_saves;
-- drop index if exists public.study_guides_visible_idx;
-- drop index if exists public.study_guides_forked_from_idx;
-- drop index if exists public.study_guides_review_idx;
-- alter table public.study_guides
--   drop constraint if exists study_guides_attribution_check,
--   drop constraint if exists study_guides_review_status_check,
--   drop constraint if exists study_guides_version_check,
--   drop constraint if exists study_guides_hold_reason_length,
--   drop column if exists visibility, drop column if exists attribution,
--   drop column if exists forked_from_guide_id, drop column if exists forked_from_version,
--   drop column if exists version, drop column if exists review_status, drop column if exists hold_reason,
--   drop column if exists visibility_migrated;
-- drop type if exists public.guide_visibility;
