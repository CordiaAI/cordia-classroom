-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 10: activity feed and friends leaderboard.
--
-- 1. user_profiles.leaderboard_opt_in: whether the student shows on the weekly friends leaderboard
--    (and so can see it). Off by default; minors are never shown, whatever this says
--    (backend services/leaderboard.py). Written only by the backend (PATCH /profiles/me).
-- 2. study_guides.published_at: when a guide first went public, for "new public guides from people
--    you follow" on the Activity tab. Set by the backend (PATCH /guides/{id}/visibility); existing
--    public guides get their created_at in the separate backfill 20261128120100.
--
-- Until this is applied: the leaderboard says it isn't available yet, and the Activity tab dates
-- public guides by when they were made.
--
-- Check afterwards:
--   select column_name from information_schema.columns
--    where (table_name = 'user_profiles' and column_name = 'leaderboard_opt_in')
--       or (table_name = 'study_guides' and column_name = 'published_at');                     -- 2 rows
--
-- Rollback:
-- drop index if exists public.study_guides_published_idx;
-- alter table public.study_guides drop column if exists published_at;
-- alter table public.user_profiles drop column if exists leaderboard_opt_in;

alter table public.user_profiles add column if not exists leaderboard_opt_in boolean not null default false;
alter table public.study_guides add column if not exists published_at timestamptz;
create index if not exists study_guides_published_idx on public.study_guides (user_id, published_at desc)
  where visibility = 'public';
