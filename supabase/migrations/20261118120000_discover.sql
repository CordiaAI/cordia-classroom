-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 7: Discover (search across public guides).
--
-- Needs, already applied before it: 20261101120000_mcp_read_access (study_guides.search_doc),
-- 20261109120000_guide_visibility (visibility, review_status), 20261112120000_guide_progress
-- (guide_progress, guide_versions) and 20261015120000_canvas_classes (shared_sets, instructor_blocks).
--
-- Text search reuses study_guides.search_doc: a generated tsvector over title (A), the outline
-- (notes, B) and the Q/A text (study_guide, C), with a GIN index already. A second, trigger-kept
-- column would index the same words twice.
--
--   is_verified_instructor(u)   true when u confirmed a school email through the instructor
--                               opt-out flow (instructor_blocks). No new flag.
--   discover_guides(q, n)       public guides that aren't held, ranked by text relevance (all of
--                               them, newest first, when q is empty). Callable by the backend only.
--   guide_quality               materialized view, one row per public guide: studied_by, mastery,
--                               7-day retention, report rate, last change, verified author. Created
--                               empty; 20261118120001_discover_quality_fill.sql fills it the first
--                               time. Schedule this nightly yourself (e.g. Supabase cron at 03:17):
--                                 refresh materialized view concurrently public.guide_quality;
-- The backend works before this is applied: Discover falls back to a plain title match and
-- quality 1, and leaves out the creator-type filter (no instructor is verified without it).
--
-- Check afterwards:
--   select to_regprocedure('public.discover_guides(text,integer)'), to_regclass('public.guide_quality');  -- both set
--   select has_table_privilege('authenticated', 'public.guide_quality', 'SELECT');               -- false
--   select has_function_privilege('authenticated', 'public.discover_guides(text,integer)', 'EXECUTE');  -- false
--
-- Rollback:
-- drop materialized view if exists public.guide_quality;
-- drop function if exists public.discover_guides(text, integer);
-- drop function if exists public.is_verified_instructor(uuid);
-- drop index if exists public.study_guides_public_idx;

create index if not exists study_guides_public_idx on public.study_guides (created_at desc)
  where visibility = 'public' and review_status = 'ok';

create or replace function public.is_verified_instructor(u uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.instructor_blocks b
    join auth.users au on lower(au.email) = lower(b.email)
    where au.id = u and au.email_confirmed_at is not null
  )
$$;
revoke execute on function public.is_verified_instructor(uuid) from public, anon, authenticated;
grant execute on function public.is_verified_instructor(uuid) to service_role;

create or replace function public.discover_guides(q text, max_results integer default 200)
returns table (id uuid, relevance real)
language sql stable security definer set search_path = ''
as $$
  select g.id,
         case when nullif(btrim(q), '') is null then 0::real
              else ts_rank(g.search_doc, websearch_to_tsquery('english', q)) end as relevance
  from public.study_guides g
  where g.visibility = 'public' and g.review_status = 'ok'
    and (nullif(btrim(q), '') is null or g.search_doc @@ websearch_to_tsquery('english', q))
  order by 2 desc, g.created_at desc
  limit least(greatest(coalesce(max_results, 200), 1), 500)
$$;
revoke execute on function public.discover_guides(text, integer) from public, anon, authenticated;
grant execute on function public.discover_guides(text, integer) to service_role;

create materialized view if not exists public.guide_quality as
with guides as (
  select g.id, g.user_id, g.created_at from public.study_guides g
  where g.visibility = 'public' and g.review_status = 'ok'
),
studiers as (
  select s.guide_id, st.user_id from public.shared_sets s join public.shared_set_studiers st on st.set_id = s.id
  union
  select gp.guide_id, gp.user_id from public.guide_progress gp
),
-- Each studier's share of ideas at Familiar or Mastered (Learn level 2+, or a card marked known).
mastery as (
  select gp.guide_id, gp.user_id, gp.created_at, gp.updated_at,
         (select count(*) filter (where (e.value ->> 'l') ~ '^[0-9]+$' and (e.value ->> 'l')::int >= 2
                                     or e.value ->> 'known' = 'true')::numeric / nullif(count(*), 0)
          from jsonb_each(case when jsonb_typeof(gp.progress) = 'object' then gp.progress else '{}'::jsonb end) e
          where jsonb_typeof(e.value) = 'object') as share
  from public.guide_progress gp
)
select g.id as guide_id,
       (select count(distinct x.user_id) from studiers x where x.guide_id = g.id and x.user_id <> g.user_id)::int as studied_by,
       (select avg(m.share) from mastery m where m.guide_id = g.id and m.user_id <> g.user_id)::real as mastery,
       -- Of those who started at least a week ago, how many were still studying it 7+ days later.
       (select avg(case when m.updated_at >= m.created_at + interval '7 days' then 1 else 0 end)
          from mastery m where m.guide_id = g.id and m.user_id <> g.user_id and m.created_at <= now() - interval '7 days')::real as retention_7d,
       ((select count(*) from public.shared_set_reports r join public.shared_sets s on s.id = r.set_id
          where s.guide_id = g.id and r.status <> 'dismissed')
        + (select count(*) from public.copyright_takedowns t where t.guide_id = g.id and t.status <> 'rejected'))::int as reports,
       greatest(g.created_at, (select max(v.created_at) from public.guide_versions v where v.guide_id = g.id)) as changed_at,
       public.is_verified_instructor(g.user_id) as verified_instructor
from guides g
with no data;

create unique index if not exists guide_quality_guide_idx on public.guide_quality (guide_id);
revoke all on table public.guide_quality from public, anon, authenticated;
grant select on table public.guide_quality to service_role;
