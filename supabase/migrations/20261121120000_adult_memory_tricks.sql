-- Crude humor in memory tricks, for confirmed adults only (feedback item 4).
-- NOT APPLIED: waiting for the owner's OK. Run after 20261120120000_feature_announcements.sql.
--
-- 1. user_profiles.adult_confirmed_at: when the student confirmed in Settings › Tutor that they are
--    18 or older. Null means not confirmed. Accounts marked as minors (is_minor) or as high school
--    (education_level = 'high_school') are never offered the confirmation, and the backend refuses it.
-- 2. learning_preferences.crude_humor: "Crude humor in memory tricks", off by default. The backend
--    honors it only while the student is a confirmed adult and not a minor or high-school account.
-- Both are written by the backend only (service role).

alter table public.user_profiles
  add column if not exists adult_confirmed_at timestamptz;

alter table public.learning_preferences
  add column if not exists crude_humor boolean not null default false;
