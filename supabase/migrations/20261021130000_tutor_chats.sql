-- Saved Tutor chats. tutor_sessions keeps the one live conversation the web app and the
-- browser side panel share; starting a new chat moves the old one here, and resuming a
-- saved chat moves it back. Only the FastAPI backend (service role) reads or writes it.
create table if not exists public.tutor_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid references public.study_guides(id) on delete set null,
  title text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutor_chats_user_updated on public.tutor_chats (user_id, updated_at desc);

alter table public.tutor_chats enable row level security;
revoke all on table public.tutor_chats from public, anon, authenticated;
grant select, insert, update, delete on table public.tutor_chats to service_role;
