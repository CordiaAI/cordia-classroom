-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 4: per-viewer progress and versions.
--
-- What this adds (nothing else changes; the app works the same until it's applied and
-- PER_VIEWER_PROGRESS=true is set on the backend):
-- 1. guide_progress: one student's progress on someone else's guide, keyed by idea id (the stable
--    id every question carries, backend/services/ideas.py), plus the version they're studying.
--    An owner's own progress stays where it is today (study_guides.flashcard_progress).
--      progress = { "<idea_id>": { box, due, known, l, at, sure, q, archived? } }
--    Room is left for spaced-repetition fields (stability, difficulty, reps, lapses) per idea.
-- 2. guide_versions: what each version of a shared guide asked (cards, quiz questions, Q/A pairs),
--    so a student can keep studying the version they started on after the author edits it. Shared
--    guides' versions only; pruned when no student is on a version older than the newest.
-- 3. merge_guide_progress(): merges one save into a student's row under a row lock, so two tabs or
--    devices never overwrite each other's answers.
-- Both tables are read and written only by the backend (service role). Visibility, takedowns,
-- holds, instructor opt-outs and blocks are checked by the backend for every version
-- (services/guide_access.py), so an old version is never served once the guide is hidden.
--
-- Check afterwards:
--   select to_regclass('public.guide_progress'), to_regclass('public.guide_versions');           -- both set
--   select has_table_privilege('authenticated', 'public.guide_progress', 'SELECT');             -- false
--   select has_function_privilege('authenticated', 'public.merge_guide_progress(uuid,uuid,jsonb,integer,jsonb,jsonb)', 'EXECUTE'); -- false
--
-- Rollback:
-- drop function if exists public.merge_guide_progress(uuid, uuid, jsonb, integer, jsonb, jsonb);
-- drop table if exists public.guide_versions;
-- drop table if exists public.guide_progress;

create table if not exists public.guide_progress (
  user_id uuid not null references auth.users on delete cascade,
  guide_id uuid not null references public.study_guides on delete cascade,
  version_seen integer not null default 1 check (version_seen > 0),
  dismissed_version integer,
  progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object' and pg_column_size(progress) < 1048576),
  test_date date,
  test_format text check (test_format in ('mc', 'short', 'essay', 'mix', 'unsure')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
create index if not exists guide_progress_guide_idx on public.guide_progress (guide_id, version_seen);
alter table public.guide_progress enable row level security;
revoke all on public.guide_progress from anon, authenticated;
grant select, insert, update, delete on public.guide_progress to service_role;

create table if not exists public.guide_versions (
  guide_id uuid not null references public.study_guides on delete cascade,
  version integer not null check (version > 0),
  title text,
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  quiz jsonb check (quiz is null or jsonb_typeof(quiz) = 'array'),
  qa jsonb not null default '[]'::jsonb check (jsonb_typeof(qa) = 'array'),
  created_at timestamptz not null default now(),
  primary key (guide_id, version),
  check (pg_column_size(cards) + coalesce(pg_column_size(quiz), 0) + pg_column_size(qa) < 4194304)
);
alter table public.guide_versions enable row level security;
revoke all on public.guide_versions from anon, authenticated;
grant select, insert, update, delete on public.guide_versions to service_role;

-- One save: `patch` holds only the ideas just answered ({idea_id: fields}); the fields sent replace
-- those fields of that idea (a flashcard save never touches its Learn level, and back); a null field
-- clears it. `version` is set only when the row is new (accepting an update changes it
-- through the table). test_date / test_format: {"value": ...} to set, null to keep.
create or replace function public.merge_guide_progress(
  viewer uuid, guide uuid, patch jsonb, version integer default 1,
  test_date jsonb default null, test_format jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.guide_progress%rowtype;
  item record;
begin
  if jsonb_typeof(coalesce(patch, '{}'::jsonb)) <> 'object' or (select count(*) from jsonb_object_keys(coalesce(patch, '{}'::jsonb))) > 2000 then
    raise exception 'Invalid progress' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(coalesce(patch, '{}'::jsonb)) loop
    if item.key !~ '^[a-z0-9]{6,32}$' or jsonb_typeof(item.value) <> 'object' or pg_column_size(item.value) > 2048 then
      raise exception 'Invalid progress entry' using errcode = '22023';
    end if;
  end loop;
  insert into public.guide_progress (user_id, guide_id, version_seen)
  values (viewer, guide, greatest(coalesce(version, 1), 1))
  on conflict (user_id, guide_id) do nothing;
  select * into saved from public.guide_progress p where p.user_id = viewer and p.guide_id = guide for update;
  update public.guide_progress p set
    progress = saved.progress || (
      select coalesce(jsonb_object_agg(e.key, jsonb_strip_nulls(
        case when jsonb_typeof(saved.progress -> e.key) = 'object' then saved.progress -> e.key else '{}'::jsonb end || e.value)), '{}'::jsonb)
      from jsonb_each(coalesce(patch, '{}'::jsonb)) e),
    test_date = case
      when merge_guide_progress.test_date is null then saved.test_date
      when jsonb_typeof(merge_guide_progress.test_date -> 'value') = 'string'
        and merge_guide_progress.test_date ->> 'value' ~ '^\d{4}-\d{2}-\d{2}$' then (merge_guide_progress.test_date ->> 'value')::date
      else null end,
    test_format = case
      when merge_guide_progress.test_format is not null
        and merge_guide_progress.test_format ->> 'value' in ('mc', 'short', 'essay', 'mix', 'unsure') then merge_guide_progress.test_format ->> 'value'
      else saved.test_format end,
    updated_at = now()
  where p.user_id = viewer and p.guide_id = guide
  returning p.progress into patch;
  return patch;
end
$$;
revoke execute on function public.merge_guide_progress(uuid, uuid, jsonb, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.merge_guide_progress(uuid, uuid, jsonb, integer, jsonb, jsonb) to service_role;
