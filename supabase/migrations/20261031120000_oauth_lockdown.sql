-- OAuth lockdown: tokens that Supabase's OAuth 2.1 server issues to connected apps (Claude and
-- other MCP clients) get NOTHING by default. Apply this, enable the access-token hook, and verify
-- (supabase/checks/oauth_lockdown.sql) BEFORE turning the OAuth server on.
--
-- How it works (tested on a local Supabase stack, CLI 2.122 / Auth v2.197 / PostgREST v16.5):
--   * The Custom Access Token hook below rewrites every token that carries a client_id:
--       role       -> mcp_client  PostgREST, Storage and GraphQL run its requests as this role, which
--                                 has no grants, so every table, view, function and schema is denied
--                                 until a later migration grants one explicitly (default-deny).
--       aud        -> the MCP resource URL, so the token is bound to the MCP server (and the FastAPI
--                                 backend, which requires aud=authenticated, refuses it too).
--       session_id -> a random id, so Supabase Auth's own /auth/v1/user endpoints refuse the token
--                                 (session_not_found). Without this an OAuth token could change the
--                                 student's password, edit user metadata or sign them out everywhere.
--   * App sign-ins (no client_id) are returned unchanged.
--   * Refreshing an OAuth token runs the hook again, so the rewrite holds for its whole life.
--
-- After applying: Dashboard -> Authentication -> Hooks -> "Customize Access Token (JWT) Claims"
-- -> Postgres -> schema public, function custom_access_token_hook -> Enable.

-- 1. Fixes that stand on their own --------------------------------------------------------------

-- user_profiles: the dashboard-era insert policy let any signed-in user insert any id.
do $$ begin
  if to_regclass('public.user_profiles') is not null then
    drop policy if exists "Allow insert for authenticated users" on public.user_profiles;
    drop policy if exists "Users insert own profile" on public.user_profiles;
    create policy "Users insert own profile" on public.user_profiles
      for insert to authenticated with check (auth.uid() = id);
  end if;
end $$;

-- canvas_tokens is backend-only: no policies and no client grants (already true in production;
-- restated so it can't drift).
do $$ begin
  if to_regclass('public.canvas_tokens') is not null then
    revoke all on table public.canvas_tokens from public, anon, authenticated;
  end if;
end $$;

-- 2. The connected-app role ---------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_client') then
    create role mcp_client nologin noinherit;
  end if;
end $$;
-- PostgREST connects as authenticator and switches to the token's role.
grant mcp_client to authenticator;
-- Same ceiling as the app's signed-in role.
alter role mcp_client set statement_timeout = '8s';
-- Deliberately nothing else. Grants for the MCP's own views and functions come with the MCP
-- migrations, each one listed in supabase/checks/oauth_lockdown.sql's allow-list.

-- 3. The access-token hook ------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
begin
  if coalesce(claims ->> 'client_id', '') <> '' then
    claims := jsonb_set(claims, '{role}', to_jsonb('mcp_client'::text));
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://classroom.cordiacode.com/mcp'::text));
    claims := jsonb_set(claims, '{session_id}', to_jsonb(gen_random_uuid()::text));
  end if;
  return jsonb_set(event, '{claims}', claims);
end
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
