-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 7: first fill of guide_quality (data step).
--
-- Run once, after 20261118120000_discover.sql. A concurrent refresh needs the view filled once, so
-- this first refresh is a plain one (it locks the view briefly; nothing reads it until it's filled).
-- After this, the nightly job runs: refresh materialized view concurrently public.guide_quality;
--
-- Check afterwards:
--   select count(*) from public.guide_quality;   -- the number of public guides that aren't held
--
-- Rollback (empties it again; Discover falls back to quality 1):
-- refresh materialized view public.guide_quality with no data;

refresh materialized view public.guide_quality;
