-- Personalization plan, step 1.2: onboarding answers, the student's study archetype, and the
-- onboarding step check matching the backend.
-- NOT APPLIED: waiting for the owner's OK. Run after 20261106120000_experiments.sql.
--
-- 1. onboarding_answers: every answer to an onboarding or day 2-7 question, kept with the question's
--    id and version (answers are weak starting settings, never a "type"). A question can be answered
--    again (the expected grade is re-asked after grades come in), so rows are appended; the newest
--    per question is the current one. Service role only: the backend reads and writes them.
-- 2. user_profiles.study_archetype: the student's report-02 archetype (one of nine), set from their
--    major, kept even while only 4-5 layout templates ship (owner decision G3).
-- 3. onboarding_progress.step: the live check rejects 'first_guide' and 'unlocked', which the backend
--    allows (backend/routers/learning.py OnboardingStep). Widened to match.

create table if not exists public.onboarding_answers (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  question_id text not null check (question_id ~ '^[a-z0-9_]{1,40}$'),
  question_version smallint not null check (question_version between 1 and 100),
  answer jsonb not null check (pg_column_size(answer) <= 4000),
  source text not null default 'onboarding' check (source in ('onboarding', 'drip', 'settings')),
  answered_at timestamptz not null default now()
);
create index if not exists onboarding_answers_user_idx on public.onboarding_answers (user_id, question_id, answered_at desc);

alter table public.onboarding_answers enable row level security;
revoke all on public.onboarding_answers from anon, authenticated;

alter table public.user_profiles add column if not exists study_archetype text
  check (study_archetype is null or study_archetype ~ '^[a-z_]{1,40}$');
alter table public.user_profiles add column if not exists archetype_version smallint;

alter table public.onboarding_progress drop constraint if exists onboarding_progress_step_check;
alter table public.onboarding_progress add constraint onboarding_progress_step_check check (step in
  ('style', 'first_guide', 'unlocked', 'extension', 'extension_use', 'create', 'smartnotes', 'practice', 'done'));
