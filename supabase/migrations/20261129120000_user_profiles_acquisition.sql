-- NOT APPLIED: waiting for owner's OK.
--
-- First-touch attribution on the profile: where a new student first came from (the public page
-- they landed on, the referring host, utm_source/medium/campaign, a ?ref= code, Cordia's own ?from= value and
-- the AI assistant that sent them, if any). No personal data. Written once, at sign-up, by the
-- backend (backend/services/acquisition.py via POST /auth/age) only when ACQUISITION_TRACKING is
-- on; the browser can't write it (authenticated may insert only the original profile columns, and
-- has no update on user_profiles).

alter table public.user_profiles add column if not exists acquisition jsonb;

alter table public.user_profiles drop constraint if exists user_profiles_acquisition_shape;
alter table public.user_profiles add constraint user_profiles_acquisition_shape
  check (acquisition is null or (jsonb_typeof(acquisition) = 'object' and octet_length(acquisition::text) <= 2048));

comment on column public.user_profiles.acquisition is
  'First-touch attribution from sign-up: landing_path, referrer_host, utm_source, utm_medium, utm_campaign, ref, from, ai_engine, first_seen. No personal data. Written once by the backend.';
