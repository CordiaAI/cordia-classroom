-- Run after supabase_stub.sql, the lockdown migration and 20261031130000_mcp_connected_apps.sql
-- (twice). Raises on any failure.
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
insert into auth.oauth_clients (id, client_name, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Claude', now() - interval '60 days'),    -- connected: kept
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Abandoned', now() - interval '60 days'), -- never connected: deleted
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Revoked', now() - interval '60 days'),   -- disconnected: deleted
  ('aaaaaaaa-0000-0000-0000-000000000004', 'New', now() - interval '2 days')         -- too new: kept
on conflict do nothing;
insert into auth.oauth_consents (user_id, client_id, revoked_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', null),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', now())
on conflict do nothing;

do $$ begin
  if not has_function_privilege('mcp_client', 'public.mcp_session_check()', 'EXECUTE') then raise exception 'mcp_client cannot run the check'; end if;
  if has_function_privilege('authenticated', 'public.mcp_session_check()', 'EXECUTE') then raise exception 'app tokens can run the check'; end if;
  if has_function_privilege('anon', 'public.mcp_session_check()', 'EXECUTE') then raise exception 'anon can run the check'; end if;
  if has_function_privilege('mcp_client', 'public.mcp_cleanup_oauth_clients()', 'EXECUTE') then raise exception 'mcp_client can run the cleanup'; end if;
  if has_function_privilege('authenticated', 'public.mcp_cleanup_oauth_clients()', 'EXECUTE') then raise exception 'authenticated can run the cleanup'; end if;
  if has_table_privilege('mcp_client', 'public.mcp_connection_activity', 'SELECT') then raise exception 'mcp_client reads activity directly'; end if;
  if has_table_privilege('authenticated', 'public.mcp_connection_activity', 'INSERT') then raise exception 'students can write activity'; end if;
end $$;

-- As the connected app (role mcp_client, with its own token's claims).
set role mcp_client;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"mcp_client","client_id":"aaaaaaaa-0000-0000-0000-000000000001"}';
do $$ begin
  if public.mcp_session_check() is not true then raise exception 'connected app refused'; end if;
end $$;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"mcp_client","client_id":"aaaaaaaa-0000-0000-0000-000000000003"}';
do $$ begin
  if public.mcp_session_check() is not false then raise exception 'disconnected app allowed'; end if;
end $$;
-- Another student's grant doesn't carry over.
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"mcp_client","client_id":"aaaaaaaa-0000-0000-0000-000000000001"}';
do $$ begin
  if public.mcp_session_check() is not false then raise exception 'grant crossed students'; end if;
end $$;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"mcp_client","client_id":"not-a-uuid"}';
do $$ begin
  if public.mcp_session_check() is not false then raise exception 'bad client_id allowed'; end if;
end $$;
reset role;

-- An app-token caller (role authenticated) gets false even if it somehow could run the function.
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"aaaaaaaa-0000-0000-0000-000000000001"}';
do $$ begin
  if public.mcp_session_check() is not false then raise exception 'non-mcp role allowed'; end if;
  if (select count(*) from public.mcp_connection_activity) <> 1 then raise exception 'last use not recorded once'; end if;
end $$;

-- Students read only their own activity.
insert into public.mcp_connection_activity (user_id, client_id) values ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000004') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from public.mcp_connection_activity) <> 1 then raise exception 'student sees other activity'; end if;
end $$;
reset role;

-- The weekly cleanup: old, unconnected self-registered apps go; connected and new ones stay.
do $$
declare removed int;
begin
  removed := public.mcp_cleanup_oauth_clients();
  if removed <> 2 then raise exception 'cleanup removed % apps, expected 2', removed; end if;
  if (select array_agg(client_name order by client_name) from auth.oauth_clients) <> array['Claude', 'New'] then raise exception 'wrong apps kept'; end if;
  if exists (select 1 from auth.oauth_consents where client_id = 'aaaaaaaa-0000-0000-0000-000000000003') then raise exception 'revoked grant left behind'; end if;
end $$;
select 'CONNECTED APPS OK';
