-- Deadlines can be checked off.
--
--   * canvas_assignments.submitted: Canvas says the student turned it in (filled by sync).
--   * deadline_marks: the student's own check, for any calendar item (Canvas access token or
--     calendar link). A mark wins over Canvas, so a student can uncheck a submitted item.
--
-- Writes go through FastAPI with the service role, like the other Canvas tables.

alter table public.canvas_assignments add column if not exists submitted boolean not null default false;

create table if not exists public.deadline_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),
  done boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.deadline_marks enable row level security;
revoke all on table public.deadline_marks from public, anon, authenticated;
