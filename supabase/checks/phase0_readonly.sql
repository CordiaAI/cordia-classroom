-- Personalization plan, Phase 0: read-only checks for the owner to run in the Supabase SQL editor.
-- Nothing here changes data. Paste the results back to Claude.

-- Step 0.6: study time is active time only. Expect max under 10800 (3 h) and zero 24-hour rows
-- since the idle fix shipped (Oct 31).
select
  (select max(duration_seconds) from public.study_sessions where started_at > '2026-10-31') as max_seconds_since_oct31,
  (select count(*) from public.study_sessions where started_at > '2026-10-31' and duration_seconds > 10800) as over_3h_since_oct31,
  (select count(*) from public.study_sessions where duration_seconds >= 86000) as full_day_rows_ever;

-- Step 0.1: the live schema, one row per table with its columns, for supabase/schema/live-2026-11.sql.
-- (Run each query on its own and paste all three results.)
select c.table_name,
       string_agg(c.column_name || ' ' || c.data_type || case when c.is_nullable = 'NO' then ' not null' else '' end
                  || coalesce(' default ' || c.column_default, ''), E',\n  ' order by c.ordinal_position) as columns
from information_schema.columns c
where c.table_schema = 'public'
group by c.table_name order by c.table_name;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by 1, 2;

-- Which migrations Supabase has recorded (to match against supabase/migrations/).
select version, name from supabase_migrations.schema_migrations order by version;
