-- Run after supabase_stub.sql and the oauth_lockdown migration (twice). Raises on any failure.
-- Stand-ins for the platform schemas the check looks at.
create schema if not exists storage;
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
create table if not exists public.canvas_courses (user_id uuid, name text);
grant select on public.canvas_courses to authenticated;
create or replace function public.is_class_member(target uuid) returns boolean language sql security definer as $$ select true $$;
revoke execute on function public.is_class_member(uuid) from public;
grant execute on function public.is_class_member(uuid) to authenticated;

do $$
declare
  app jsonb := '{"user_id":"11111111-1111-1111-1111-111111111111","authentication_method":"password","claims":{"iss":"https://x.supabase.co/auth/v1","aud":"authenticated","exp":9999999999,"iat":1,"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1","session_id":"22222222-2222-2222-2222-222222222222","email":"s@example.test","phone":"","is_anonymous":false}}';
  oauth jsonb := '{"user_id":"11111111-1111-1111-1111-111111111111","authentication_method":"oauth_provider/authorization_code","claims":{"iss":"https://x.supabase.co/auth/v1","aud":"authenticated","exp":9999999999,"iat":1,"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1","session_id":"22222222-2222-2222-2222-222222222222","email":"s@example.test","phone":"","is_anonymous":false,"client_id":"abc","scope":"email"}}';
  out jsonb;
  violations int;
begin
  -- App sign-ins come back unchanged.
  out := public.custom_access_token_hook(app);
  if out <> app then raise exception 'hook changed an app token: %', out; end if;

  -- Connected-app tokens: own role, MCP audience, detached session, everything else kept.
  out := public.custom_access_token_hook(oauth) -> 'claims';
  if out ->> 'role' <> 'mcp_client' then raise exception 'role not rewritten: %', out; end if;
  if out ->> 'aud' <> 'https://classroom.cordiacode.com/mcp' then raise exception 'aud not rewritten: %', out; end if;
  if out ->> 'session_id' = '22222222-2222-2222-2222-222222222222' then raise exception 'session_id kept'; end if;
  if (out ->> 'session_id')::uuid is null then raise exception 'session_id not a uuid'; end if;
  if out ->> 'sub' <> '11111111-1111-1111-1111-111111111111' or out ->> 'client_id' <> 'abc' or out ->> 'email' is null
     or out ->> 'exp' is null or out ->> 'iat' is null or out ->> 'aal' is null or out ->> 'iss' is null or out ->> 'is_anonymous' is null then
    raise exception 'required claims lost: %', out;
  end if;
  -- An empty client_id is not an OAuth token.
  out := public.custom_access_token_hook(jsonb_set(oauth, '{claims,client_id}', '""')) -> 'claims';
  if out ->> 'role' <> 'authenticated' then raise exception 'empty client_id rewritten'; end if;

  -- Only Supabase Auth may run the hook.
  if has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') then raise exception 'authenticated can run the hook'; end if;
  if has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') then raise exception 'anon can run the hook'; end if;
  if not has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') then raise exception 'auth admin cannot run the hook'; end if;

  -- The connected-app role reaches nothing that was granted to authenticated.
  if not pg_has_role('authenticator', 'mcp_client', 'member') then raise exception 'authenticator cannot switch to mcp_client'; end if;
  if has_table_privilege('mcp_client', 'public.canvas_courses', 'SELECT') then raise exception 'mcp_client reads canvas_courses'; end if;
  if has_table_privilege('mcp_client', 'public.study_guides', 'SELECT') then raise exception 'mcp_client reads study_guides'; end if;
  if has_schema_privilege('mcp_client', 'storage', 'USAGE') then raise exception 'mcp_client uses storage'; end if;
  if has_function_privilege('mcp_client', 'public.is_class_member(uuid)', 'EXECUTE') then raise exception 'mcp_client runs a security definer function'; end if;

  -- user_profiles: only your own row.
  if exists (select 1 from pg_policies where tablename = 'user_profiles' and with_check = 'true') then raise exception 'open insert policy still there'; end if;
  if not exists (select 1 from pg_policies where tablename = 'user_profiles' and policyname = 'Users insert own profile') then raise exception 'own-row insert policy missing'; end if;
end $$;

-- As the authenticated role, inserting someone else's profile is refused.
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    insert into public.user_profiles (id) values ('33333333-3333-3333-3333-333333333333');
    raise exception 'inserted another user''s profile';
  exception when insufficient_privilege then null;
  end;
  insert into public.user_profiles (id) values ('11111111-1111-1111-1111-111111111111');
end $$;
reset role;
select 'LOCKDOWN OK';
