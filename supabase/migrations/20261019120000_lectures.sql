-- Lectures (NOT APPLIED: waiting for the owner's OK; run on a dev/preview database first).
--
-- 1. lectures: one row per lecture: a recording's transcript, an uploaded recording, or notes /
--    a transcript typed or pasted in. No audio is stored. analysis holds what the AI pulled out
--    of it (summary, what to watch for, to-dos, outline, key terms, the professor's questions).
-- 2. lecture_todos: assignments, readings and deadlines said in a lecture. They reach Calendar
--    and Today only once the student confirms them.
-- Only the web server (service role) reads or writes these tables, always filtered to the
-- signed-in student; students never get direct access.

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id uuid,                      -- the class (folders.id); kept plain so the migration stands alone
  title text not null default 'Lecture',
  source text not null default 'recording' check (source in ('recording', 'upload', 'notes')),
  lecture_date date not null default current_date,
  duration_ms integer not null default 0,
  transcript text not null default '',
  segments jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  guide_id uuid,                       -- study guide made from this lecture, if any
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lectures_user_idx on public.lectures (user_id, lecture_date desc);
alter table public.lectures enable row level security;
revoke all on public.lectures from anon, authenticated;

create table if not exists public.lecture_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  title text not null,
  kind text not null default 'assignment' check (kind in ('assignment', 'reading', 'exam', 'other')),
  due_at timestamptz,
  said text not null default '',
  quote text not null default '',
  at_ms integer not null default 0,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists lecture_todos_user_idx on public.lecture_todos (user_id, status, due_at);
alter table public.lecture_todos enable row level security;
revoke all on public.lecture_todos from anon, authenticated;
-- No policies on either table: no direct student access.
