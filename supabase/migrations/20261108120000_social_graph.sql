-- NOT APPLIED: waiting for owner's OK. Run after 20261107130000_profiles_blocks.sql.
--
-- Social plan, Stage 2: follows, friendships and notifications.
--
-- 1. follows: one row per follower -> followee. 'pending' while the followee approves (their
--    allow_follows = 'approval'); 'active' otherwise.
-- 2. friendships: one row per pair, user_a < user_b so a pair can't appear twice. 'pending' until
--    the other person accepts; requested_by says who asked. Accepting also makes both follow each
--    other (the backend writes those rows).
-- 3. notifications: what happened to you (follow, follow_request, friend_request, friend_accepted),
--    with the actor in payload. You can read your own; only the backend writes them.
-- 4. social_rate_events: one row per follow or friend request, so the backend can enforce the daily
--    limits (100 follows, 30 friend requests). The app's other limiter counts in memory per server
--    and resets on deploy, so it can't count a day.
-- 5. are_friends(a, b) for later RLS policies; the backend checks friendship itself (the service
--    role bypasses RLS).
-- Blocking (Stage 1's user_blocks) makes the backend delete follows and friendships between the
-- pair in both directions.

create table if not exists public.follows (
  follower_id uuid not null references auth.users on delete cascade,
  followee_id uuid not null references auth.users on delete cascade,
  status text not null default 'active' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, status);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, insert, update, delete on public.follows to service_role;

create table if not exists public.friendships (
  user_a uuid not null references auth.users on delete cascade,
  user_b uuid not null references auth.users on delete cascade,
  requested_by uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index if not exists friendships_user_b_idx on public.friendships (user_b);
create index if not exists friendships_requested_by_idx on public.friendships (requested_by);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select, insert, update, delete on public.friendships to service_role;

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, id desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;
grant usage, select on sequence public.notifications_id_seq to service_role;
drop policy if exists "Read own notifications" on public.notifications;
create policy "Read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.social_rate_events (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  action text not null check (action in ('follow', 'friend_request')),
  created_at timestamptz not null default now()
);
create index if not exists social_rate_events_user_idx on public.social_rate_events (user_id, action, created_at desc);
alter table public.social_rate_events enable row level security;
revoke all on public.social_rate_events from anon, authenticated;
grant select, insert, update, delete on public.social_rate_events to service_role;
grant usage, select on sequence public.social_rate_events_id_seq to service_role;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(a, b) and user_b = greatest(a, b) and status = 'accepted'
  );
$$;
-- Not callable by clients (it would reveal who is friends with whom); a later policy grants it.
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;
grant execute on function public.are_friends(uuid, uuid) to service_role;

-- Check afterwards:
--   select to_regclass('public.follows'), to_regclass('public.friendships'),
--          to_regclass('public.notifications'), to_regclass('public.social_rate_events');   -- all set
--   select has_table_privilege('authenticated', 'public.follows', 'SELECT');               -- false
--   select has_table_privilege('authenticated', 'public.notifications', 'INSERT');         -- false

-- Rollback:
-- drop function if exists public.are_friends(uuid, uuid);
-- drop table if exists public.social_rate_events;
-- drop table if exists public.notifications;
-- drop table if exists public.friendships;
-- drop table if exists public.follows;
