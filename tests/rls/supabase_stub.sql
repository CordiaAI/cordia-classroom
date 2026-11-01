-- Minimal stand-in for the Supabase platform so migrations and RLS policies can run
-- against a throwaway local Postgres. Never run this against a real project.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin noinherit login; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Tables that predate the migrations folder (created in the Supabase dashboard).
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text
);
create table if not exists public.study_guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text,
  study_guide text,
  flashcards jsonb,
  folder_id uuid references public.folders(id) on delete set null
);
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text
);
alter table public.user_profiles enable row level security;
-- The dashboard-era policy the lockdown migration replaces.
drop policy if exists "Allow insert for authenticated users" on public.user_profiles;
create policy "Allow insert for authenticated users" on public.user_profiles for insert with check (true);
grant select, insert on public.user_profiles to authenticated;


-- Supabase Auth's OAuth 2.1 server tables (only the columns our functions use).
create table if not exists auth.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  registration_type text not null default 'dynamic',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists auth.oauth_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.oauth_clients(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, client_id)
);

-- Tables the MCP read migration grants on (only the columns it touches), with the dashboard-era
-- own-row policies production has.
alter table public.folders add column if not exists created_at timestamptz default now();
alter table public.folders add column if not exists class_id uuid;
alter table public.study_guides add column if not exists notes text;
alter table public.study_guides add column if not exists flashcard_progress jsonb;
alter table public.study_guides add column if not exists quiz_questions jsonb;
alter table public.study_guides add column if not exists practice_state jsonb;
alter table public.study_guides add column if not exists source_type text;
alter table public.study_guides add column if not exists source_title text;
alter table public.study_guides add column if not exists source_url text;
alter table public.study_guides add column if not exists created_at timestamptz default now();
create table if not exists public.smart_notes (id uuid primary key default gen_random_uuid(), user_id uuid, title text, content text, folder_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.lectures (id uuid primary key default gen_random_uuid(), user_id uuid, folder_id uuid, title text, source text, lecture_date date, duration_ms integer, transcript text, segments jsonb, analysis jsonb, guide_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.lecture_todos (id uuid primary key default gen_random_uuid(), user_id uuid, lecture_id uuid, title text, kind text, due_at timestamptz, said text, quote text, at_ms integer, status text, created_at timestamptz default now());
create table if not exists public.study_sessions (id uuid primary key default gen_random_uuid(), user_id uuid, guide_id uuid, session_type text, started_at timestamptz, ended_at timestamptz, duration_seconds integer, metadata jsonb);
create table if not exists public.quiz_attempts (id uuid primary key default gen_random_uuid(), user_id uuid, guide_id uuid, score integer, total_questions integer, correct_answers integer, answers jsonb, completed_at timestamptz);
create table if not exists public.user_streaks (user_id uuid primary key, current_streak integer, longest_streak integer, last_study_date date, updated_at timestamptz);
create table if not exists public.learning_events (id bigserial primary key, user_id uuid, item_id text, guide_id uuid, mode text, outcome text, confidence text, occurred_at timestamptz default now());
do $$
declare t text;
begin
  foreach t in array array['folders', 'study_guides', 'study_sessions', 'quiz_attempts', 'user_streaks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for select using (auth.uid() = user_id)', t);
  end loop;
  foreach t in array array['smart_notes', 'lectures', 'lecture_todos', 'learning_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
drop policy if exists "Users can read own profile" on public.user_profiles;
create policy "Users can read own profile" on public.user_profiles for select using (auth.uid() = id);
grant select, insert, update, delete on public.folders, public.study_guides, public.smart_notes, public.lectures to authenticated;
