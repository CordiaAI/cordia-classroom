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

