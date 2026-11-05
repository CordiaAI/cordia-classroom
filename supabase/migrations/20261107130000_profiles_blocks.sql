-- NOT APPLIED: waiting for owner's OK. Run after 20261107120000_drop_browser_write_policies.sql.
--
-- Social plan, Stage 1: usernames, public profiles, privacy settings and blocking.
--
-- 1. user_profiles gains a username (case-insensitive, unique) and privacy settings. Everything is
--    written by the backend (routers/profiles.py) with the service role, which also enforces the
--    username rules (format, reserved words, 30 days between changes).
-- 2. username_history keeps a released username for 90 days, so /u/<old> redirects to the new one
--    and nobody else can take it in that time.
-- 3. user_blocks: either side's block hides each from the other everywhere. is_blocked() answers
--    "did either of these two block the other?" for later RLS policies; the backend checks blocks
--    itself (services/blocks.py) because the service role bypasses RLS.
--
-- Deliberate change from the plan: user_profiles stays readable only by its owner. The table holds
-- email, university, major and timezone, and RLS filters rows, not columns, so a "public profiles
-- are readable" policy would hand every public user's email to any signed-in client. Other people's
-- profiles are served only by GET /profiles/{username}, which returns the fields the viewer may see
-- (the browser never reads user_profiles directly). The own-row insert policy stays (the OAuth
-- lockdown test expects it), but a browser insert can no longer set the new columns.

create extension if not exists citext with schema extensions;

alter table public.user_profiles
  add column if not exists username extensions.citext,
  add column if not exists display_name text,
  add column if not exists show_real_name boolean not null default false,
  add column if not exists profile_visibility text not null default 'public',
  add column if not exists allow_follows text not null default 'everyone',
  add column if not exists allow_friend_requests text not null default 'everyone',
  add column if not exists show_school boolean not null default true,
  add column if not exists show_streak boolean not null default false,
  add column if not exists is_minor boolean not null default false,
  add column if not exists username_changed_at timestamptz;

alter table public.user_profiles drop constraint if exists user_profiles_username_format;
alter table public.user_profiles add constraint user_profiles_username_format
  check (username is null or username::text ~ '^[a-z0-9_.]{3,24}$');
alter table public.user_profiles drop constraint if exists user_profiles_display_name_length;
alter table public.user_profiles add constraint user_profiles_display_name_length
  check (display_name is null or char_length(display_name) between 1 and 50);
alter table public.user_profiles drop constraint if exists user_profiles_profile_visibility_check;
alter table public.user_profiles add constraint user_profiles_profile_visibility_check
  check (profile_visibility in ('public', 'friends', 'private'));
alter table public.user_profiles drop constraint if exists user_profiles_allow_follows_check;
alter table public.user_profiles add constraint user_profiles_allow_follows_check
  check (allow_follows in ('everyone', 'approval'));
alter table public.user_profiles drop constraint if exists user_profiles_allow_friend_requests_check;
alter table public.user_profiles add constraint user_profiles_allow_friend_requests_check
  check (allow_friend_requests in ('everyone', 'friends_of_friends', 'nobody'));
create unique index if not exists user_profiles_username_key on public.user_profiles (username);

-- The browser may still insert its own empty profile row, but only the original columns.
revoke insert on public.user_profiles from anon, authenticated;
grant insert (id, email, name, university, major, education_level, timezone) on public.user_profiles to authenticated;

create table if not exists public.username_history (
  old_username extensions.citext primary key,
  user_id uuid not null references auth.users on delete cascade,
  released_at timestamptz not null default now()
);
create index if not exists username_history_user_idx on public.username_history (user_id);
alter table public.username_history enable row level security;
revoke all on public.username_history from anon, authenticated;
grant select, insert, update, delete on public.username_history to service_role;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select, insert, update, delete on public.user_blocks to service_role;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
-- Not callable by clients: it would let anyone ask who blocked whom. A later RLS policy that needs it
-- grants execute to authenticated in its own migration.
revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked(uuid, uuid) to service_role;

-- Check afterwards:
--   select column_name from information_schema.columns where table_name = 'user_profiles' and column_name in
--     ('username','display_name','show_real_name','profile_visibility','allow_follows','allow_friend_requests',
--      'show_school','show_streak','is_minor','username_changed_at');            -- 10 rows
--   select to_regclass('public.username_history'), to_regclass('public.user_blocks');  -- both set
--   select has_table_privilege('authenticated', 'public.user_blocks', 'SELECT');        -- false
--   select has_column_privilege('authenticated', 'public.user_profiles', 'username', 'INSERT');  -- false

-- Rollback:
-- drop function if exists public.is_blocked(uuid, uuid);
-- drop table if exists public.user_blocks;
-- drop table if exists public.username_history;
-- revoke insert (id, email, name, university, major, education_level, timezone) on public.user_profiles from authenticated;
-- grant insert on public.user_profiles to authenticated;
-- drop index if exists public.user_profiles_username_key;
-- alter table public.user_profiles
--   drop constraint if exists user_profiles_username_format,
--   drop constraint if exists user_profiles_display_name_length,
--   drop constraint if exists user_profiles_profile_visibility_check,
--   drop constraint if exists user_profiles_allow_follows_check,
--   drop constraint if exists user_profiles_allow_friend_requests_check,
--   drop column if exists username, drop column if exists display_name, drop column if exists show_real_name,
--   drop column if exists profile_visibility, drop column if exists allow_follows,
--   drop column if exists allow_friend_requests, drop column if exists show_school,
--   drop column if exists show_streak, drop column if exists is_minor, drop column if exists username_changed_at;
-- (citext stays installed; other objects may use it.)
