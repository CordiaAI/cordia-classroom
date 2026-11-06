-- NOT APPLIED: waiting for owner's OK. Merging duplicate study sets.
--
-- Cordia suggests merging two of a student's own sets that cover the same material (a word-overlap
-- check, then a Claude Haiku check). Merging adds set B's new cards, questions and notes to set A,
-- moves B's study history to A, and keeps a full copy of B here so it can be restored for 30 days.
-- B itself is deleted the normal way, so nothing else that reads study_guides changes.
--   guide_duplicate_checks  one row per pair of a student's sets that looked alike: the AI's verdict
--                           (checked once per pair and version) and whether the student said Not now
--   guide_merge_backups     the merged-away set as it was, the history rows moved to the kept set
--                           (by table and id, to move back), and rows that are deleted with a set
--                           (retain_misses, study_aids), to put back on restore
-- Both are backend-only (service role); students never read them directly. Until this is applied,
-- the duplicate suggestions and merging are off and the rest of the app works as before.
--
-- Old backups: the backend clears a student's backups older than 30 days when it lists them. To clear
-- everyone's nightly too (optional), schedule:
--   select cron.schedule('guide-merge-backups-purge', '29 4 * * *', $$select public.purge_guide_merge_backups()$$);
--
-- Check afterwards:
--   select to_regclass('public.guide_duplicate_checks'), to_regclass('public.guide_merge_backups');   -- both set
--   select has_table_privilege('authenticated', 'public.guide_merge_backups', 'SELECT');               -- false
--   select public.purge_guide_merge_backups();                                                          -- 0
--
-- Rollback:
-- select cron.unschedule('guide-merge-backups-purge');   -- only if it was scheduled
-- drop function if exists public.purge_guide_merge_backups();
-- drop table if exists public.guide_merge_backups;
-- drop table if exists public.guide_duplicate_checks;

create table if not exists public.guide_duplicate_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_a uuid not null,                 -- the lower id of the pair
  guide_b uuid not null,                 -- the higher id
  verdict text not null check (verdict in ('same', 'different')),
  score real,                            -- the word-overlap score that put the pair up for checking
  a_version integer,                     -- the versions the AI saw; an edit allows one new check
  b_version integer,
  checked_at timestamptz not null default now(),
  dismissed_at timestamptz,              -- Not now: never suggested again
  primary key (user_id, guide_a, guide_b),
  check (guide_a < guide_b)
);
create index if not exists guide_duplicate_checks_day on public.guide_duplicate_checks (user_id, checked_at);

create table if not exists public.guide_merge_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kept_guide_id uuid not null,           -- no foreign key: deleting the kept set keeps the backup
  merged_guide_id uuid not null,
  merged_guide jsonb not null,           -- the merged-away study_guides row, every column
  moved jsonb not null default '{}'::jsonb,       -- {"quiz_attempts": [ids], ...} moved to the kept set
  saved_rows jsonb not null default '{}'::jsonb,  -- {"retain_misses": [rows], "study_aids": [rows]}
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  check (pg_column_size(merged_guide) < 4000000)
);
create index if not exists guide_merge_backups_kept on public.guide_merge_backups (user_id, kept_guide_id, created_at desc);

create or replace function public.purge_guide_merge_backups()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.guide_merge_backups where created_at < now() - interval '30 days' returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function public.purge_guide_merge_backups() from public, anon, authenticated;
grant execute on function public.purge_guide_merge_backups() to service_role;

alter table public.guide_duplicate_checks enable row level security;
alter table public.guide_merge_backups enable row level security;
revoke all on table public.guide_duplicate_checks, public.guide_merge_backups from public, anon, authenticated;
grant select, insert, update, delete on table public.guide_duplicate_checks, public.guide_merge_backups to service_role;
