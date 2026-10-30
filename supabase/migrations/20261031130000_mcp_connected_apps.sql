-- MCP Phase 1: connected apps. Run after 20261031120000_oauth_lockdown.sql.
--   * mcp_session_check(): the MCP endpoint calls it on every request with the connected app's own
--     token. It says whether the student still has that app connected (a Disconnect in Settings
--     revokes the grant, and this cuts the app off at once instead of when its token expires) and
--     records when the app was last used. It's the only thing the mcp_client role can run.
--   * mcp_connection_activity: last-used times for Settings › Connected AI apps (own rows only).
--   * A weekly job deletes apps that registered themselves more than 30 days ago and that no
--     student has connected (Claude registers a new app for every connection attempt).

-- 1. Last-used times ------------------------------------------------------------------------------

create table if not exists public.mcp_connection_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  last_used_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
alter table public.mcp_connection_activity enable row level security;
revoke all on table public.mcp_connection_activity from public, anon, authenticated;
grant select on table public.mcp_connection_activity to authenticated;
drop policy if exists "Users read own connected-app activity" on public.mcp_connection_activity;
create policy "Users read own connected-app activity" on public.mcp_connection_activity
  for select to authenticated using (auth.uid() = user_id);

-- 2. The per-request grant check ---------------------------------------------------------------------

create or replace function public.mcp_session_check()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  uid uuid;
  cid uuid;
begin
  if claims ->> 'role' is distinct from 'mcp_client' then
    return false;
  end if;
  begin
    uid := (claims ->> 'sub')::uuid;
    cid := (claims ->> 'client_id')::uuid;
  exception when others then
    return false;
  end;
  if uid is null or cid is null then
    return false;
  end if;
  if not exists (
    select 1 from auth.oauth_consents c
    where c.user_id = uid and c.client_id = cid and c.revoked_at is null
  ) then
    return false;
  end if;
  -- At most one write a minute per app.
  insert into public.mcp_connection_activity as a (user_id, client_id, last_used_at)
  values (uid, cid, now())
  on conflict (user_id, client_id) do update set last_used_at = excluded.last_used_at
  where a.last_used_at < now() - interval '1 minute';
  return true;
end
$$;

revoke execute on function public.mcp_session_check() from public, anon, authenticated;
grant execute on function public.mcp_session_check() to mcp_client;

-- 3. Weekly cleanup of unused self-registered apps -----------------------------------------------

create or replace function public.mcp_cleanup_oauth_clients()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  -- Deleting an app also deletes its old (revoked) grants, pending requests and sessions.
  delete from auth.oauth_clients c
  where c.registration_type = 'dynamic'
    and c.created_at < now() - interval '30 days'
    and not exists (select 1 from auth.oauth_consents g where g.client_id = c.id and g.revoked_at is null);
  get diagnostics removed = row_count;
  delete from public.mcp_connection_activity a
  where not exists (select 1 from auth.oauth_clients c where c.id = a.client_id);
  return removed;
end
$$;

revoke execute on function public.mcp_cleanup_oauth_clients() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('mcp-oauth-client-cleanup', '23 4 * * 0', 'select public.mcp_cleanup_oauth_clients()');
  end if;
end $$;

notify pgrst, 'reload schema';
