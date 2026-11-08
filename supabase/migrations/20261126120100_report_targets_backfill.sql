-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 9 data backfill. Run after
-- 20261126120000_safety_hardening.sql.
--
-- Reports filed on a class set before Stage 9 name only set_id. Give each its target (the guide
-- behind the set), so the admin queue and the 3-reporter hold see them with the new reports. A set
-- with no guide keeps target_type null and stays in the queue by set_id. Where the same person
-- already has a row for that guide (or reported two of its sets), only one row takes the target
-- and the rest stay set-only (the unique index allows one target row per person). Safe to run more than once.
--
-- Check afterwards:
--   select count(*) from public.shared_set_reports r join public.shared_sets s on s.id = r.set_id
--    where r.target_type is null and s.guide_id is not null;                    -- 0, or only duplicates
--
-- Rollback (puts these rows back to set-only):
-- update public.shared_set_reports set target_type = null, target_id = null
--  where set_id is not null and target_type = 'guide'
--    and target_id = (select guide_id from public.shared_sets s where s.id = set_id);

with firsts as (
  -- One row per person and guide: someone may have reported two class sets of the same guide.
  select distinct on (s.guide_id, r.reporter_id) r.id, s.guide_id
  from public.shared_set_reports r
  join public.shared_sets s on s.id = r.set_id
  where r.target_type is null and s.guide_id is not null
  order by s.guide_id, r.reporter_id, r.created_at
)
update public.shared_set_reports r
set target_type = 'guide', target_id = f.guide_id
from firsts f
where r.id = f.id
  and not exists (
    select 1 from public.shared_set_reports other
    where other.target_type = 'guide' and other.target_id = f.guide_id and other.reporter_id = r.reporter_id);
