-- Personalization plan, step 1.1: which onboarding each new student was given.
-- NOT APPLIED: waiting for the owner's OK.
--
-- One row per student and experiment, written once by the backend (services/experiments.py) at the
-- student's first onboarding read, only while ONBOARDING_EXPERIMENT is on. The arm comes from a
-- hash of the student and experiment ids (80% v2, 20% old, owner decision Q14), so it never changes;
-- the stratum (sign-in method, Canvas connected) is kept for the analysis. Service role only.

create table if not exists public.experiment_assignments (
  user_id uuid not null references auth.users on delete cascade,
  experiment text not null check (experiment ~ '^[a-z0-9_]{1,40}$'),
  arm text not null check (arm ~ '^[a-z0-9_]{1,20}$'),
  bucket real not null check (bucket >= 0 and bucket < 1),
  stratum jsonb not null default '{}'::jsonb,
  assigned_at timestamptz not null default now(),
  primary key (user_id, experiment)
);
create index if not exists experiment_assignments_arm_idx on public.experiment_assignments (experiment, arm, assigned_at);

alter table public.experiment_assignments enable row level security;
revoke all on public.experiment_assignments from anon, authenticated;
