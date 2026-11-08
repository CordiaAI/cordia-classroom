-- NOT APPLIED: waiting for owner's OK. Copyright takedowns are reviewed by staff before anything
-- is held or removed. Run after 20261126120100_report_targets_backfill.sql (it needs
-- copyright_takedowns.profile_id from 20261126120000_safety_hardening.sql).
--
-- 1. copyright_takedowns: what staff did and when, and what an item looked like before a hold.
--    - duplicate_count / last_reported_at: later reports on the same item attach to the open one.
--    - confirmed_by / confirmed_at: the staff member who confirmed the reporter by email from
--      support@cordiaai.io (required before "Take down").
--    - held_by / held_at: a temporary hold staff placed from the queue while confirming.
--    - set_status_before, guide_status_before, guide_hold_reason_before: the item's state when this
--      report's hold or removal was applied, so rejecting restores exactly that and nothing else.
--    - actioned_by: who decided the report.
-- 2. One open report per item: partial unique indexes on the guide, the class set, the profile,
--    and (for links Cordia couldn't match to an item) the link text.
-- 3. An index for the daily cap, which counts today's rows across every backend machine.
-- 4. Discover's guide_quality: only actioned takedowns count toward a guide's reports, not received
--    or rejected ones. The view is rebuilt with that one change and filled again.
--
-- The notification type for owners ("copyright_report") needs no schema change: notifications.kind
-- only has to match ^[a-z_]{1,40}$.
--
-- Check afterwards:
--   select column_name from information_schema.columns where table_schema = 'public'
--     and table_name = 'copyright_takedowns' and column_name in ('duplicate_count', 'confirmed_by',
--     'held_by', 'set_status_before', 'guide_status_before', 'actioned_by');           -- 6 rows
--   select indexname from pg_indexes where tablename = 'copyright_takedowns';           -- 5 new indexes
--   select count(*) from public.guide_quality;                                          -- filled
--
-- Rollback (the guide_quality part restores 20261118120000_discover.sql's definition):
--   drop index if exists public.copyright_takedowns_open_guide, public.copyright_takedowns_open_set,
--     public.copyright_takedowns_open_profile, public.copyright_takedowns_open_link,
--     public.copyright_takedowns_created;
--   alter table public.copyright_takedowns drop column if exists duplicate_count,
--     drop column if exists last_reported_at, drop column if exists confirmed_by,
--     drop column if exists confirmed_at, drop column if exists held_by, drop column if exists held_at,
--     drop column if exists set_status_before, drop column if exists guide_status_before,
--     drop column if exists guide_hold_reason_before, drop column if exists actioned_by;

-- 1. Review columns ----------------------------------------------------------------------------------

alter table public.copyright_takedowns
  add column if not exists duplicate_count integer not null default 0 check (duplicate_count >= 0),
  add column if not exists last_reported_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists held_by uuid references auth.users(id) on delete set null,
  add column if not exists held_at timestamptz,
  add column if not exists set_status_before text check (set_status_before is null or set_status_before in ('visible', 'held', 'hidden', 'taken_down')),
  add column if not exists guide_status_before text check (guide_status_before is null or guide_status_before in ('ok', 'held', 'hidden')),
  add column if not exists guide_hold_reason_before text check (guide_hold_reason_before is null or char_length(guide_hold_reason_before) <= 300),
  add column if not exists actioned_by uuid references auth.users(id) on delete set null;

-- 2. One open report per item ------------------------------------------------------------------------

create unique index if not exists copyright_takedowns_open_guide
  on public.copyright_takedowns (guide_id) where status = 'received' and guide_id is not null;
create unique index if not exists copyright_takedowns_open_set
  on public.copyright_takedowns (set_id) where status = 'received' and set_id is not null and guide_id is null;
create unique index if not exists copyright_takedowns_open_profile
  on public.copyright_takedowns (profile_id) where status = 'received' and profile_id is not null;
create unique index if not exists copyright_takedowns_open_link
  on public.copyright_takedowns (lower(location)) where status = 'received' and guide_id is null and set_id is null and profile_id is null;

-- 3. The daily cap counts rows created since midnight UTC -------------------------------------------

create index if not exists copyright_takedowns_created on public.copyright_takedowns (created_at);

-- 4. Discover quality: only actioned takedowns are reports ------------------------------------------

drop materialized view if exists public.guide_quality;
create materialized view public.guide_quality as
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
        -- A takedown counts only once staff have actioned it, never while received or once rejected.
        + (select count(*) from public.copyright_takedowns t where t.guide_id = g.id and t.status = 'actioned'))::int as reports,
       greatest(g.created_at, (select max(v.created_at) from public.guide_versions v where v.guide_id = g.id)) as changed_at,
       public.is_verified_instructor(g.user_id) as verified_instructor
from guides g
with no data;

create unique index if not exists guide_quality_guide_idx on public.guide_quality (guide_id);
revoke all on table public.guide_quality from public, anon, authenticated;
grant select on table public.guide_quality to service_role;
-- Filled now so Discover keeps working; the nightly job refreshes it concurrently from here on.
refresh materialized view public.guide_quality;
