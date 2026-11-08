-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 10 data backfill. Run after
-- 20261128120000_activity_leaderboard.sql.
--
-- Public guides made before Stage 10 have no published_at: use when they were made, so the
-- Activity tab can date them. Safe to run more than once.
--
-- Check afterwards:
--   select count(*) from public.study_guides where visibility = 'public' and published_at is null;  -- 0
--
-- Rollback (only rows this set; later publishes keep their own time):
-- update public.study_guides set published_at = null where published_at = created_at;

update public.study_guides set published_at = created_at
where visibility = 'public' and published_at is null;
