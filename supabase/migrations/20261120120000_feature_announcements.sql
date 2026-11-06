-- NOT APPLIED: waiting for owner's OK. What's new: which new features a student has been shown,
-- opened or dismissed.
--
-- onboarding_progress has no JSON field to reuse (only step, completed_at, updated_at), so this adds
-- one: features = {"announced": [ids], "opened": [ids], "dismissed": [ids]} (ids from
-- web/lib/featureReleases.js). Written only by the backend (PUT /onboarding/features), which merges
-- and caps the lists. Until this runs, the web app keeps the same lists in the browser.
--
-- Check afterwards:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'onboarding_progress' and column_name = 'features';   -- jsonb
--
-- Rollback:
-- alter table public.onboarding_progress drop column if exists features;

alter table public.onboarding_progress add column if not exists features jsonb not null default '{}'::jsonb;
alter table public.onboarding_progress drop constraint if exists onboarding_progress_features_check;
alter table public.onboarding_progress add constraint onboarding_progress_features_check
  check (jsonb_typeof(features) = 'object' and pg_column_size(features) < 16384);
