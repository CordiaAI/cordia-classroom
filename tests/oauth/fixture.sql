-- Local-only fixture for tests/oauth/run_local_probe.sh: tables shaped like production's
-- sensitive data, with production's own policies (pg_policies, 2026-10-30), plus storage and
-- realtime. Never run against a real project.

create table public.study_guides (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), title text);
alter table public.study_guides enable row level security;
create policy "Users can view own guides" on public.study_guides for select using (auth.uid() = user_id);
create policy "Users can insert own guides" on public.study_guides for insert with check (auth.uid() = user_id);
grant select, insert on public.study_guides to authenticated;

create table public.canvas_courses (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), canvas_course_id bigint, name text, current_grade text);
alter table public.canvas_courses enable row level security;
create policy "Users read own canvas courses" on public.canvas_courses for select to authenticated using (user_id = auth.uid());
grant select, insert on public.canvas_courses to authenticated;
create policy "fixture insert" on public.canvas_courses for insert to authenticated with check (user_id = auth.uid());

create table public.canvas_assignments (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), title text, due_at timestamptz, rubric jsonb);
alter table public.canvas_assignments enable row level security;
create policy "Users read own canvas assignments" on public.canvas_assignments for select to authenticated using (user_id = auth.uid());
create policy "fixture insert" on public.canvas_assignments for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.canvas_assignments to authenticated;

create table public.canvas_tokens (user_id uuid, ciphertext text);
alter table public.canvas_tokens enable row level security;

create table public.connector_settings (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), connector text, stats jsonb);
alter table public.connector_settings enable row level security;
create policy "fixture own" on public.connector_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.connector_settings to authenticated;

create table public.assistant_links (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), phone text);
alter table public.assistant_links enable row level security;
create policy "fixture own" on public.assistant_links for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.assistant_links to authenticated;

create table public.user_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), plan text, stripe_customer_id text);
alter table public.user_subscriptions enable row level security;
create policy "own" on public.user_subscriptions for select using (auth.uid() = user_id);
create policy "fixture insert" on public.user_subscriptions for insert with check (auth.uid() = user_id);
grant select, insert on public.user_subscriptions to authenticated;

create table public.user_profiles (id uuid primary key, email text, name text);
alter table public.user_profiles enable row level security;
create policy "Allow insert for authenticated users" on public.user_profiles for insert with check (true);
create policy "Users can read own profile" on public.user_profiles for select using (auth.uid() = id);
grant select, insert on public.user_profiles to authenticated;

create or replace function public.is_class_member(target_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
revoke execute on function public.is_class_member(uuid) from public, anon;
grant execute on function public.is_class_member(uuid) to authenticated;

-- Published for the probe only (production publishes none); applied after the lockdown check runs.

-- Tables the MCP read tools use (columns they touch), with production's policies.
alter table public.study_guides add column folder_id uuid, add column notes text, add column study_guide text, add column flashcards jsonb,
  add column flashcard_progress jsonb, add column quiz_questions jsonb, add column practice_state jsonb, add column source_type text,
  add column source_title text, add column source_url text, add column created_at timestamptz default now();
create table public.folders (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), name text not null, class_id uuid, created_at timestamptz default now());
alter table public.folders enable row level security;
create policy "Users can view own folders" on public.folders for select using (auth.uid() = user_id);
create policy "Users can insert own folders" on public.folders for insert with check (auth.uid() = user_id);
create table public.smart_notes (id uuid primary key default gen_random_uuid(), user_id uuid, title text, content text, folder_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.lectures (id uuid primary key default gen_random_uuid(), user_id uuid, folder_id uuid, title text, source text, lecture_date date, duration_ms integer, transcript text, segments jsonb, analysis jsonb, guide_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.lecture_todos (id uuid primary key default gen_random_uuid(), user_id uuid, lecture_id uuid, title text, kind text, due_at timestamptz, said text, quote text, at_ms integer, status text, created_at timestamptz default now());
create table public.study_sessions (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), guide_id uuid, session_type text, started_at timestamptz, ended_at timestamptz, duration_seconds integer, metadata jsonb);
create table public.quiz_attempts (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), guide_id uuid, score integer, total_questions integer, correct_answers integer, answers jsonb, completed_at timestamptz);
create table public.user_streaks (user_id uuid primary key, current_streak integer, longest_streak integer, last_study_date date, updated_at timestamptz);
create table public.learning_events (id bigserial primary key, user_id uuid, item_id text, guide_id uuid, mode text, outcome text, confidence text, occurred_at timestamptz default now());
create table public.classes (id uuid primary key default gen_random_uuid(), course_code_normalized text, display_name text);
create table public.class_terms (id uuid primary key default gen_random_uuid(), class_id uuid references public.classes(id));
create table public.class_memberships (user_id uuid, class_term_id uuid references public.class_terms(id), source text);
do $$
declare t text;
begin
  foreach t in array array['smart_notes', 'lectures', 'lecture_todos', 'study_sessions', 'quiz_attempts', 'user_streaks', 'learning_events', 'classes', 'class_terms', 'class_memberships'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['study_sessions', 'quiz_attempts', 'user_streaks'] loop
    execute format('create policy "own rows" on public.%I for select using (auth.uid() = user_id)', t);
  end loop;
end $$;
grant select, insert, update on public.folders, public.study_sessions, public.quiz_attempts to authenticated;

-- Columns the MCP write tools use, and stand-ins for the plan-usage functions the backend calls
-- (nothing used yet, so every plan limit has room).
alter table public.study_guides add column source_guide_id uuid, add column external_source_id text, add column source_id text;
alter table public.learning_events add column decision_id uuid, add column format text, add column first_key_ms integer, add column submit_ms integer,
  add column hidden_ms integer not null default 0, add column rapid_guess boolean not null default false, add column answer_chars integer,
  add column view_shown text, add column fsrs_rating smallint, add column same_day boolean not null default false,
  add column arm text not null default 'fsrs', add column params_version text not null default 'none';
create or replace function public.feature_usage_counts(p_user_id uuid, p_month text) returns table (feature text, used integer)
language sql stable as $$ select null::text, 0 where false $$;
create or replace function public.record_feature_usage(p_user_id uuid, p_feature text, p_month text, p_request_key text) returns void
language sql as $$ select $$;
revoke execute on function public.feature_usage_counts(uuid, text), public.record_feature_usage(uuid, text, text, text) from public, anon, authenticated;
