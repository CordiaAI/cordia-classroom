-- Read-only check: everything the connected-app role (mcp_client) can reach that isn't on the
-- allow-list. Expect ZERO rows. Run it against production after the lockdown migration and after
-- every MCP migration, and CI runs it on a local database (tests/test_oauth_lockdown.py).
--
-- The allow-list: every view and function an MCP migration grants to mcp_client, one by one.
with allowed(kind, name) as (
  values ('none', 'none'),
  -- 20261031130000_mcp_connected_apps.sql: is this app still connected? (records last use)
  ('function', 'public.mcp_session_check()'),
  -- 20261101120000_mcp_read_access.sql: search, and the columns the read tools use (own rows only,
  -- by RLS; never source_title, source_url, source_id, external_source_id or folders.name)
  ('function', 'public.search_my_materials(search text, course uuid, kinds text[], max_results integer)'),
  ('column', 'public.study_guides.id'), ('column', 'public.study_guides.user_id'), ('column', 'public.study_guides.folder_id'), ('column', 'public.study_guides.title'), ('column', 'public.study_guides.notes'), ('column', 'public.study_guides.study_guide'), ('column', 'public.study_guides.flashcards'), ('column', 'public.study_guides.flashcard_progress'), ('column', 'public.study_guides.quiz_questions'), ('column', 'public.study_guides.practice_state'), ('column', 'public.study_guides.source_type'), ('column', 'public.study_guides.created_at'), ('column', 'public.study_guides.search_doc'),
  ('column', 'public.folders.id'), ('column', 'public.folders.user_id'), ('column', 'public.folders.created_at'), ('column', 'public.folders.lms_named'), ('column', 'public.folders.own_name'),
  ('column', 'public.lectures.id'), ('column', 'public.lectures.user_id'), ('column', 'public.lectures.folder_id'), ('column', 'public.lectures.title'), ('column', 'public.lectures.lecture_date'), ('column', 'public.lectures.duration_ms'), ('column', 'public.lectures.transcript'), ('column', 'public.lectures.segments'), ('column', 'public.lectures.analysis'), ('column', 'public.lectures.guide_id'), ('column', 'public.lectures.created_at'), ('column', 'public.lectures.search_doc'),
  ('column', 'public.lecture_todos.id'), ('column', 'public.lecture_todos.user_id'), ('column', 'public.lecture_todos.lecture_id'), ('column', 'public.lecture_todos.title'), ('column', 'public.lecture_todos.kind'), ('column', 'public.lecture_todos.due_at'), ('column', 'public.lecture_todos.quote'), ('column', 'public.lecture_todos.at_ms'), ('column', 'public.lecture_todos.status'),
  ('column', 'public.smart_notes.id'), ('column', 'public.smart_notes.user_id'), ('column', 'public.smart_notes.title'), ('column', 'public.smart_notes.content'), ('column', 'public.smart_notes.folder_id'), ('column', 'public.smart_notes.created_at'), ('column', 'public.smart_notes.updated_at'), ('column', 'public.smart_notes.search_doc'),
  ('column', 'public.study_sessions.user_id'), ('column', 'public.study_sessions.guide_id'), ('column', 'public.study_sessions.session_type'), ('column', 'public.study_sessions.started_at'), ('column', 'public.study_sessions.ended_at'), ('column', 'public.study_sessions.duration_seconds'), ('column', 'public.study_sessions.metadata'),
  ('column', 'public.quiz_attempts.user_id'), ('column', 'public.quiz_attempts.guide_id'), ('column', 'public.quiz_attempts.score'), ('column', 'public.quiz_attempts.total_questions'), ('column', 'public.quiz_attempts.correct_answers'), ('column', 'public.quiz_attempts.answers'), ('column', 'public.quiz_attempts.completed_at'),
  ('column', 'public.user_streaks.user_id'), ('column', 'public.user_streaks.current_streak'), ('column', 'public.user_streaks.longest_streak'), ('column', 'public.user_streaks.last_study_date'),
  ('column', 'public.user_profiles.id'), ('column', 'public.user_profiles.timezone'),
  ('column', 'public.learning_events.user_id'), ('column', 'public.learning_events.item_id'), ('column', 'public.learning_events.guide_id'), ('column', 'public.learning_events.outcome'), ('column', 'public.learning_events.confidence'), ('column', 'public.learning_events.occurred_at'),
  ('column', 'public.retain_misses.user_id'), ('column', 'public.retain_misses.guide_id'), ('column', 'public.retain_misses.items'), ('column', 'public.retain_misses.updated_at'),
  ('column', 'public.study_days.user_id'), ('column', 'public.study_days.day'), ('column', 'public.study_days.minutes'), ('column', 'public.study_days.cards'), ('column', 'public.study_days.right_count'), ('column', 'public.study_days.total'), ('column', 'public.study_days.guides'), ('column', 'public.study_days.updated_at'),
  ('column', 'public.generation_jobs.id'), ('column', 'public.generation_jobs.user_id'), ('column', 'public.generation_jobs.kind'), ('column', 'public.generation_jobs.status'), ('column', 'public.generation_jobs.progress'), ('column', 'public.generation_jobs.study_set_id'), ('column', 'public.generation_jobs.error'), ('column', 'public.generation_jobs.created_at'), ('column', 'public.generation_jobs.updated_at'),
  -- 20261102120000_mcp_write_tools.sql: the write tools, each a SECURITY DEFINER function with its
  -- own checks (own guides only, never an assignment guide, add-only), the rate limiter and the
  -- metadata-only audit log; the job's title; and logging the student's own answers (mode 'mcp').
  ('function', 'public.mcp_record_answer(answer_key text, guide uuid, cards jsonb, learn jsonb, misses jsonb, practice jsonb, study_day jsonb, result jsonb)'),
  ('function', 'public.mcp_add_flashcards(guide uuid, cards jsonb)'),
  ('function', 'public.mcp_save_note(title text, notes text, course uuid, study_set uuid)'),
  ('function', 'public.queue_study_set_job(source_kind text, source_text text, source_url text, title text, course uuid, outputs text[])'),
  ('function', 'public.mcp_take_call(kind text)'),
  ('function', 'public.mcp_log_tool_call(tool text, status text, error_code text, latency_ms integer)'),
  ('column', 'public.generation_jobs.title'),
  ('column', 'public.learning_events.decision_id'), ('column', 'public.learning_events.mode'), ('column', 'public.learning_events.format'), ('column', 'public.learning_events.first_key_ms'), ('column', 'public.learning_events.submit_ms'), ('column', 'public.learning_events.hidden_ms'), ('column', 'public.learning_events.rapid_guess'), ('column', 'public.learning_events.answer_chars'), ('column', 'public.learning_events.view_shown'), ('column', 'public.learning_events.fsrs_rating'), ('column', 'public.learning_events.same_day'), ('column', 'public.learning_events.arm'), ('column', 'public.learning_events.params_version'),
  ('sequence', 'public.learning_events_id_seq')
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
-- Single columns granted without the whole table (connected apps read guides column by column).
select 'column', format('%I.%I.%I', s.nspname, c.relname, a.attname)
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join checked_schemas s on s.oid = c.relnamespace
where exists (select 1 from pg_roles where rolname = 'mcp_client')
  and a.attnum > 0 and not a.attisdropped
  and c.relkind in ('r', 'v', 'm', 'f', 'p')
  and (s.nspname = 'public' or has_schema_privilege('mcp_client', s.oid, 'USAGE'))
  and not has_table_privilege('mcp_client', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and has_column_privilege('mcp_client', c.oid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
  and (('column', format('%I.%I.%I', s.nspname, c.relname, a.attname))) not in (select kind, name from allowed)
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
