-- Student-chosen study style (VARK) and cached per-question study aids.
-- A missing row means "no preference": Classroom behaves exactly as before.
-- The FastAPI service is the only data owner; browser clients receive no table grants.

create table if not exists public.learning_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  style text check (style in ('visual', 'aural', 'read_write', 'kinesthetic', 'multimodal')),
  prompted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.learning_preferences enable row level security;
revoke all on table public.learning_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.learning_preferences to service_role;

create table if not exists public.study_aids (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid not null references public.study_guides(id) on delete cascade,
  item_key text not null check (char_length(item_key) = 64),
  mode text not null check (mode in ('visual', 'aural', 'read_write', 'kinesthetic')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, guide_id, item_key, mode)
);

alter table public.study_aids enable row level security;
revoke all on table public.study_aids from public, anon, authenticated;
grant select, insert, update, delete on table public.study_aids to service_role;
