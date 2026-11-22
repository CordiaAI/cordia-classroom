-- NOT APPLIED: waiting for owner's OK.
-- Do NOT run this inside a transaction. `create index concurrently` (below) cannot, and it is used on purpose:
-- usage_events gets a row for every AI call, so a plain create index would block those inserts while it builds.
-- Run this file on its own, as the only statement in the SQL editor (no begin; ... commit; around it).
--
-- F11 Tutor voice mode review fix: a student's monthly voice use is the sum of their `tutor_voice` rows in
-- usage_events (backend/services/entitlements.py measured_usage), and the web app counts their `tutor_voice_turn`
-- rows the same way (web/lib/server/lectures.mjs). Both look up (user_id, feature) over a month of created_at;
-- the existing indexes cover only created_at and (feature, created_at), so each lookup scans every student's rows
-- for that feature. This index makes both a short range read.
--
-- Safe to apply any time, and the code works with or without it (only slower without). If a run is interrupted it
-- can leave an invalid index behind: drop it (drop index concurrently if exists public.usage_events_user_feature_created_idx;)
-- and run this again.
--
-- Check afterwards:
--   select indexrelid::regclass, indisvalid from pg_index where indexrelid = 'public.usage_events_user_feature_created_idx'::regclass;  -- indisvalid = t

create index concurrently if not exists usage_events_user_feature_created_idx
  on public.usage_events (user_id, feature, created_at);
