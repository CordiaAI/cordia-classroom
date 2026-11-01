-- MCP Phase 2: what the read tools need, and the app data they share with the web app.
-- Run after 20261031130000_mcp_connected_apps.sql. Safe to run twice.
--
--   1. user_profiles.timezone, set by the app (set_my_timezone); dates go out in it, UTC until set.
--   2. folders.lms_named: the folder's name came from Canvas or the calendar feed and the student
--      hasn't renamed it. own_name is the name only when the student chose it, so connected apps
--      label the others "Course 1", "Course 2" and never see a Canvas course name.
--   3. retain_misses and study_days: Retain misses and the daily study log, which lived only in the
--      browser. The app keeps a copy there and uploads what it has once.
--   4. Full-text search over guides, flashcards, notes and lectures: search_my_materials(), one
--      SECURITY INVOKER function the app's search and the MCP both call, so RLS applies.
--   5. generation_jobs: the job rows get_job_status reads (Phase 3 fills them).
--   6. Read access for connected apps (mcp_client): column by column, own rows only. Columns that
--      hold Canvas data (source_title, source_url, source_id, external_source_id, folders.name) are
--      never granted, and guides built from a Canvas assignment are hidden. Every grant here is
--      listed in supabase/checks/oauth_lockdown.sql.

-- 1. Time zone -------------------------------------------------------------------------------------

alter table public.user_profiles add column if not exists timezone text;

create or replace function public.set_my_timezone(tz text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  insert into public.user_profiles as p (id, timezone) values (auth.uid(), tz)
  on conflict (id) do update set timezone = excluded.timezone
  where p.timezone is distinct from excluded.timezone;
end
$$;
revoke execute on function public.set_my_timezone(text) from public, anon;
grant execute on function public.set_my_timezone(text) to authenticated;

-- 2. Course labels ---------------------------------------------------------------------------------

alter table public.folders add column if not exists lms_named boolean not null default false;
alter table public.folders add column if not exists own_name text
  generated always as (case when lms_named then null else name end) stored;

-- A rename makes the name the student's own (unless the same update marks it as Canvas's again).
create or replace function public.folders_rename_clears_lms_named()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name and new.lms_named is not distinct from old.lms_named then
    new.lms_named := false;
  end if;
  return new;
end
$$;
revoke execute on function public.folders_rename_clears_lms_named() from public, anon, authenticated;
drop trigger if exists folders_rename_clears_lms_named on public.folders;
create trigger folders_rename_clears_lms_named before update of name on public.folders
  for each row execute function public.folders_rename_clears_lms_named();

-- Backfill: a class folder still named exactly as Cordia named it from Canvas or the calendar feed
-- (backend/services/class_db.py ensure_folder: "<code> <display name>", 100 characters at most).
do $$ begin
  if to_regclass('public.classes') is not null and to_regclass('public.class_memberships') is not null then
    update public.folders f set lms_named = true
    from public.classes c
    where f.class_id = c.id
      and not f.lms_named
      and f.name = left(c.course_code_normalized || coalesce(' ' || nullif(c.display_name, ''), ''), 100)
      and exists (
        select 1 from public.class_memberships m join public.class_terms t on t.id = m.class_term_id
        where m.user_id = f.user_id and t.class_id = c.id and m.source in ('canvas', 'calendar'));
  end if;
end $$;

-- 3. Retain misses and the daily study log -----------------------------------------------------------

-- Per guide, the browser's list as is: [{question, answer, sure?}], sure ones first, 50 at most.
create table if not exists public.retain_misses (
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid not null references public.study_guides(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, guide_id),
  constraint retain_misses_items_shape check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50 and pg_column_size(items) <= 200000)
);

-- One row per local day: minutes, cards, right/total answers and per-guide minutes, like the
-- browser's cordiaActivity log ({m, c, r, t, g}).
create table if not exists public.study_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  minutes real not null default 0 check (minutes >= 0 and minutes <= 1440),
  cards integer not null default 0 check (cards >= 0),
  right_count integer not null default 0 check (right_count >= 0),
  total integer not null default 0 check (total >= 0),
  guides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint study_days_guides_shape check (jsonb_typeof(guides) = 'object' and pg_column_size(guides) <= 50000)
);

alter table public.retain_misses enable row level security;
alter table public.study_days enable row level security;
revoke all on table public.retain_misses from public, anon, authenticated;
revoke all on table public.study_days from public, anon, authenticated;
grant select, insert, update, delete on table public.retain_misses to authenticated;
grant select, insert, update, delete on table public.study_days to authenticated;

drop policy if exists "Students manage their own retain misses" on public.retain_misses;
create policy "Students manage their own retain misses" on public.retain_misses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from public.study_guides g where g.id = guide_id and g.user_id = auth.uid()));
drop policy if exists "Students manage their own study days" on public.study_days;
create policy "Students manage their own study days" on public.study_days
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Search -----------------------------------------------------------------------------------------

alter table public.study_guides add column if not exists search_doc tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A')
  || setweight(to_tsvector('english', left(coalesce(notes, ''), 200000)), 'B')
  || setweight(to_tsvector('english', left(regexp_replace(coalesce(study_guide, ''), '\[IMG:[^\]]*\]', ' ', 'g'), 200000)), 'C')
) stored;
create index if not exists study_guides_search_doc_idx on public.study_guides using gin (search_doc);

alter table public.smart_notes add column if not exists search_doc tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A')
  || setweight(to_tsvector('english', left(regexp_replace(coalesce(content, ''), '<[^>]*>', ' ', 'g'), 200000)), 'B')
) stored;
create index if not exists smart_notes_search_doc_idx on public.smart_notes using gin (search_doc);

alter table public.lectures add column if not exists search_doc tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A')
  || setweight(to_tsvector('english', left(coalesce(analysis ->> 'outline_md', '') || ' ' || coalesce((analysis -> 'summary')::text, '') || ' ' || coalesce((analysis -> 'terms')::text, ''), 100000)), 'B')
  || setweight(to_tsvector('english', left(coalesce(transcript, ''), 300000)), 'C')
) stored;
create index if not exists lectures_search_doc_idx on public.lectures using gin (search_doc);

-- Ranked full-text search across the caller's own material. SECURITY INVOKER: what it returns is
-- exactly what the caller's own grants and RLS allow (app sign-ins and connected apps alike).
create or replace function public.search_my_materials(search text, course uuid default null, kinds text[] default null, max_results integer default 8)
returns table (kind text, id uuid, title text, course_id uuid, snippet text, timestamp_seconds integer, card_index integer, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(search, ''), 500)) as query,
           least(greatest(coalesce(max_results, 8), 1), 50) as n
  ),
  guides as (
    select 'study_guide'::text as kind, g.id, g.title, g.folder_id as course_id,
           left(ts_headline('english', left(coalesce(nullif(g.notes, ''), regexp_replace(coalesce(g.study_guide, ''), '\[IMG:[^\]]*\]', ' ', 'g')), 20000), q.query,
             'MaxWords=45, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""'), 800) as snippet,
           null::integer as timestamp_seconds, null::integer as card_index, ts_rank(g.search_doc, q.query) as rank
    from public.study_guides g, q
    where (kinds is null or 'study_guide' = any(kinds)) and (course is null or g.folder_id = course) and g.search_doc @@ q.query
    order by rank desc limit (select n from q)
  ),
  cards as (
    select 'flashcard'::text, g.id, g.title, g.folder_id,
           left(coalesce(c.card ->> 'front', '') || ' — ' || coalesce(c.card ->> 'back', ''), 800),
           null::integer, (c.ord - 1)::integer,
           0.9 * ts_rank(to_tsvector('english', coalesce(c.card ->> 'front', '') || ' ' || coalesce(c.card ->> 'back', '')), q.query)
    from public.study_guides g
    cross join q
    cross join lateral jsonb_array_elements(case when jsonb_typeof(g.flashcards) = 'array' then g.flashcards else '[]'::jsonb end) with ordinality as c(card, ord)
    where (kinds is null or 'flashcard' = any(kinds)) and (course is null or g.folder_id = course)
      and to_tsvector('english', coalesce(c.card ->> 'front', '') || ' ' || coalesce(c.card ->> 'back', '')) @@ q.query
    order by 8 desc limit (select n from q)
  ),
  notes as (
    select 'note'::text, s.id, s.title, s.folder_id,
           left(ts_headline('english', left(regexp_replace(coalesce(s.content, ''), '<[^>]*>', ' ', 'g'), 20000), q.query,
             'MaxWords=45, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""'), 800),
           null::integer, null::integer, ts_rank(s.search_doc, q.query)
    from public.smart_notes s, q
    where (kinds is null or 'note' = any(kinds)) and (course is null or s.folder_id = course) and s.search_doc @@ q.query
    order by 8 desc limit (select n from q)
  ),
  lectures as (
    select 'lecture'::text, l.id, l.title, l.folder_id,
           left(coalesce(seg.text, ts_headline('english', left(coalesce(l.transcript, ''), 20000), q.query,
             'MaxWords=45, MinWords=15, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""')), 800),
           (seg.start_ms / 1000)::integer, null::integer, ts_rank(l.search_doc, q.query)
    from public.lectures l
    cross join q
    left join lateral (
      select s ->> 'text' as text, (s ->> 'start_ms')::bigint as start_ms
      from jsonb_array_elements(case when jsonb_typeof(l.segments) = 'array' then l.segments else '[]'::jsonb end) as s
      where to_tsvector('english', coalesce(s ->> 'text', '')) @@ q.query
      limit 1
    ) seg on true
    where (kinds is null or 'lecture' = any(kinds)) and (course is null or l.folder_id = course) and l.search_doc @@ q.query
    order by 8 desc limit (select n from q)
  )
  select * from (
    select * from guides union all select * from cards union all select * from notes union all select * from lectures
  ) found
  order by rank desc, title
  limit (select n from q)
$$;
revoke execute on function public.search_my_materials(text, uuid, text[], integer) from public, anon;
grant execute on function public.search_my_materials(text, uuid, text[], integer) to authenticated, mcp_client;

-- The app's own search reads notes and lectures with the student's sign-in too (own rows only).
drop policy if exists "Students read their own notes" on public.smart_notes;
create policy "Students read their own notes" on public.smart_notes
  for select to authenticated, mcp_client using (auth.uid() = user_id);
drop policy if exists "Students read their own lectures" on public.lectures;
create policy "Students read their own lectures" on public.lectures
  for select to authenticated, mcp_client using (auth.uid() = user_id);

-- 5. Generation jobs (rows are created and run in Phase 3) ------------------------------------------

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'study_set',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress real check (progress is null or (progress >= 0 and progress <= 1)),
  study_set_id uuid references public.study_guides(id) on delete set null,
  error text,
  source text not null default 'app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists generation_jobs_user_idx on public.generation_jobs (user_id, created_at desc);
alter table public.generation_jobs enable row level security;
revoke all on table public.generation_jobs from public, anon, authenticated;
grant select on table public.generation_jobs to authenticated;
drop policy if exists "Students read their own jobs" on public.generation_jobs;
create policy "Students read their own jobs" on public.generation_jobs
  for select to authenticated, mcp_client using (auth.uid() = user_id);

-- 6. Read access for connected apps --------------------------------------------------------------

-- Guides: the content and the student's progress; never the columns that point back to Canvas.
grant select (id, user_id, folder_id, title, notes, study_guide, flashcards, flashcard_progress, quiz_questions, practice_state, source_type, created_at, search_doc)
  on public.study_guides to mcp_client;
drop policy if exists "Connected apps never see assignment guides" on public.study_guides;
create policy "Connected apps never see assignment guides" on public.study_guides
  as restrictive for select to mcp_client
  using (coalesce(source_type, '') <> 'assignment');

grant select (id, user_id, created_at, lms_named, own_name) on public.folders to mcp_client;
grant select (id, user_id, folder_id, title, lecture_date, duration_ms, transcript, segments, analysis, guide_id, created_at, search_doc)
  on public.lectures to mcp_client;
grant select (id, user_id, lecture_id, title, kind, due_at, quote, at_ms, status) on public.lecture_todos to mcp_client;
drop policy if exists "Connected apps read the student's lecture to-dos" on public.lecture_todos;
create policy "Connected apps read the student's lecture to-dos" on public.lecture_todos
  for select to mcp_client using (auth.uid() = user_id);
grant select (id, user_id, title, content, folder_id, created_at, updated_at, search_doc) on public.smart_notes to mcp_client;
grant select (user_id, guide_id, session_type, started_at, ended_at, duration_seconds, metadata) on public.study_sessions to mcp_client;
grant select (user_id, guide_id, score, total_questions, correct_answers, answers, completed_at) on public.quiz_attempts to mcp_client;
grant select (user_id, current_streak, longest_streak, last_study_date) on public.user_streaks to mcp_client;
grant select (id, timezone) on public.user_profiles to mcp_client;
grant select (user_id, item_id, guide_id, outcome, confidence, occurred_at) on public.learning_events to mcp_client;
drop policy if exists "Connected apps read the student's answers" on public.learning_events;
create policy "Connected apps read the student's answers" on public.learning_events
  for select to mcp_client using (auth.uid() = user_id);
grant select (user_id, guide_id, items, updated_at) on public.retain_misses to mcp_client;
drop policy if exists "Connected apps read the student's retain misses" on public.retain_misses;
create policy "Connected apps read the student's retain misses" on public.retain_misses
  for select to mcp_client using (auth.uid() = user_id);
grant select (user_id, day, minutes, cards, right_count, total, guides, updated_at) on public.study_days to mcp_client;
drop policy if exists "Connected apps read the student's study days" on public.study_days;
create policy "Connected apps read the student's study days" on public.study_days
  for select to mcp_client using (auth.uid() = user_id);
grant select (id, user_id, kind, status, progress, study_set_id, error, created_at, updated_at) on public.generation_jobs to mcp_client;

notify pgrst, 'reload schema';
