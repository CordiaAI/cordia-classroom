-- Read-only check: everything the connected-app role (mcp_client) can reach that isn't on the
-- allow-list. Expect ZERO rows. Run it against production after the lockdown migration and after
-- every MCP migration, and CI runs it on a local database (tests/test_oauth_lockdown.py).
--
-- The allow-list: every view and function an MCP migration grants to mcp_client, one by one.
with allowed(kind, name) as (
  values ('none', 'none'),
  -- 20261031130000_mcp_connected_apps.sql: is this app still connected? (records last use)
  ('function', 'public.mcp_session_check()')
),
-- Platform schemas Supabase grants to PUBLIC and owns (supabase_admin), so no migration of ours
-- can revoke them, and which the Data API does not expose (exposed schemas: public,
-- graphql_public). pg_net ("net") is used by the Cordia Assistant's cron jobs, which run as
-- postgres. Any new role, including mcp_client, holds PUBLIC's usage here; it is reachable only
-- through raw SQL, which no API surface gives a token. Keep this list to exactly these.
platform_exempt(nspname) as (
  values ('net')
),
checked_schemas as (
  select n.oid, n.nspname
  from pg_namespace n
  where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
    and n.nspname not in (select nspname from platform_exempt)
    and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
)
select 'role missing' as kind, 'mcp_client' as name
where not exists (select 1 from pg_roles where rolname = 'mcp_client')
union all
select 'role not granted to authenticator', 'mcp_client'
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and exists (select 1 from pg_roles where rolname = 'authenticator')
  and not pg_has_role('authenticator', 'mcp_client', 'member')
union all
select 'inherits another role', r.rolname
from pg_auth_members m join pg_roles r on r.oid = m.roleid
where m.member = (select oid from pg_roles where rolname = 'mcp_client')
union all
-- Realtime sends Postgres changes only for published tables. Production publishes none and the
-- app doesn't use Realtime; a denied subscriber would still learn that a change happened, so any
-- table added here needs review.
select 'realtime publication', format('%I.%I', t.schemaname, t.tablename)
from pg_publication_tables t
where t.pubname = 'supabase_realtime'
  and (('realtime publication', format('%I.%I', t.schemaname, t.tablename))) not in (select kind, name from allowed)
union all
select 'schema usage', s.nspname
from checked_schemas s
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and s.nspname <> 'public'
  and has_schema_privilege('mcp_client', s.oid, 'USAGE')
  and (('schema', s.nspname)) not in (select kind, name from allowed)
union all
select 'table', format('%I.%I', s.nspname, c.relname)
from pg_class c join checked_schemas s on s.oid = c.relnamespace
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and (s.nspname = 'public' or has_schema_privilege('mcp_client', s.oid, 'USAGE'))
  and case when c.relkind in ('r', 'v', 'm', 'f', 'p')
    then has_table_privilege('mcp_client', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') else false end
  and (('table', format('%I.%I', s.nspname, c.relname))) not in (select kind, name from allowed)
union all
select 'sequence', format('%I.%I', s.nspname, c.relname)
from pg_class c join checked_schemas s on s.oid = c.relnamespace
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and (s.nspname = 'public' or has_schema_privilege('mcp_client', s.oid, 'USAGE'))
  and case when c.relkind = 'S' then has_sequence_privilege('mcp_client', c.oid, 'USAGE, SELECT, UPDATE') else false end
  and (('sequence', format('%I.%I', s.nspname, c.relname))) not in (select kind, name from allowed)
union all
-- Functions: only those in schemas the role can use matter, but list any PUBLIC-executable one
-- in public too, because a later schema grant would expose it. Extension functions installed in
-- public (pgcrypto, uuid-ossp: plain library code) are skipped; extension functions in any other
-- schema the role could use (pg_net's net.http_post, say) are still reported.
select 'function', format('%I.%I(%s)', s.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
from pg_proc p join checked_schemas s on s.oid = p.pronamespace
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and has_function_privilege('mcp_client', p.oid, 'EXECUTE')
  and (s.nspname = 'public' or has_schema_privilege('mcp_client', s.oid, 'USAGE'))
  and not (s.nspname = 'public' and exists (
    select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'))
  and (('function', format('%I.%I(%s)', s.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))) not in (select kind, name from allowed)
order by 1, 2;
