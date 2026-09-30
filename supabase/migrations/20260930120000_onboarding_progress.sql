-- Setup wizard progress: which step each student reached and when they finished.
-- A missing row means the student has not seen the wizard yet.
-- The FastAPI service is the only data owner; browser clients receive no table grants.

create table if not exists public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  step text not null check (step in ('style', 'extension', 'extension_use', 'create', 'smartnotes', 'practice', 'done')),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.onboarding_progress enable row level security;
revoke all on table public.onboarding_progress from public, anon, authenticated;
grant select, insert, update, delete on table public.onboarding_progress to service_role;
