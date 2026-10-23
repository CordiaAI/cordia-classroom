-- Connector sync, phase 1: Canvas + Google Calendar + Google Tasks (NOT APPLIED: waiting for the owner's OK).
-- Needs 20261023120000_connector_settings.sql first.
--
-- Ground rules this supports:
-- * Cordia writes only into its own containers (a "Cordia" calendar, a "Cordia" task list); their ids
--   live on connector_settings.container_id.
-- * Every object Cordia writes elsewhere has one row in connector_links (cordia_id <-> external_id),
--   so updates and deletes follow it and nothing is created twice.
-- * Source of truth per field: Canvas owns due dates, points, rubric and grades; the student owns
--   when they study (study_blocks they move or delete stay that way); completion is two-way
--   (Cordia, Canvas submission or a checked-off Google Task all mark a step done).
-- * Connector health: last sync, last error, needs-reconnect and counts for the Connectors cards.
-- Service role only, like the rest of Classroom's server tables.

-- 1. Health and the Cordia container for each connected app.
alter table public.connector_settings
  add column if not exists container_id text check (char_length(container_id) <= 300),
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_error text check (char_length(last_error) <= 300),
  add column if not exists needs_reconnect boolean not null default false,
  add column if not exists stats jsonb not null default '{}';

-- 2. What Cordia wrote where. cordia_id is Cordia's key ('canvas-123', 'step:<uuid>', 'block:<uuid>').
create table if not exists public.connector_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null check (char_length(connector) <= 40),
  kind text not null check (kind in ('task', 'subtask', 'event', 'page', 'file')),
  cordia_id text not null check (char_length(cordia_id) <= 200),
  external_id text not null check (char_length(external_id) <= 300),
  container_id text check (char_length(container_id) <= 300),
  -- Hash of what Cordia last wrote; a different value read back means the student edited it.
  synced_hash text check (char_length(synced_hash) <= 64),
  -- The student deleted it on their side: never recreate it.
  removed_by_student boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, connector, kind, cordia_id),
  unique (user_id, connector, external_id)
);

-- 3. More of Canvas: what an assignment asks for, how it's graded, and when Cordia first saw it.
alter table public.canvas_assignments
  add column if not exists points_possible numeric,
  add column if not exists submission_types text[] not null default '{}',
  add column if not exists description text check (char_length(description) <= 20000),
  add column if not exists rubric jsonb,
  add column if not exists html_url text check (char_length(html_url) <= 1000),
  add column if not exists missing boolean not null default false,
  add column if not exists score numeric,
  add column if not exists is_exam boolean not null default false,
  add column if not exists canvas_updated_at timestamptz,
  add column if not exists first_seen_at timestamptz not null default now();

alter table public.canvas_courses
  add column if not exists current_score numeric,
  add column if not exists current_grade text check (char_length(current_grade) <= 10),
  add column if not exists grade_checked_at timestamptz;

create table if not exists public.canvas_announcements (
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_announcement_id bigint not null,
  canvas_course_id bigint not null,
  title text not null default '' check (char_length(title) <= 500),
  message text not null default '' check (char_length(message) <= 20000),
  posted_at timestamptz,
  summary text check (char_length(summary) <= 600),
  -- What it changes for the student, so the digest can flag it.
  changes text not null default 'none' check (changes in ('none', 'deadline', 'new_work')),
  read_at timestamptz,
  primary key (user_id, canvas_announcement_id)
);
create index if not exists canvas_announcements_recent_idx on public.canvas_announcements (user_id, posted_at desc);

-- 4. Breaking an assignment into steps, and the study blocks that cover them.
create table if not exists public.assignment_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),
  effort_minutes integer not null check (effort_minutes between 5 and 6000),
  effort_basis text check (char_length(effort_basis) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create table if not exists public.assignment_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),
  position smallint not null check (position between 0 and 20),
  title text not null check (char_length(title) between 1 and 200),
  minutes integer not null check (minutes between 5 and 3000),
  due_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  unique (user_id, item_key, position),
  foreign key (user_id, item_key) references public.assignment_plans(user_id, item_key) on delete cascade
);

create table if not exists public.study_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),
  step_id uuid references public.assignment_steps(id) on delete set null,
  kind text not null default 'work' check (kind in ('work', 'review')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  -- moved / removed: the student changed it in their calendar; Cordia keeps their choice and learns from it.
  status text not null default 'planned' check (status in ('planned', 'moved', 'removed', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_blocks_user_time_idx on public.study_blocks (user_id, starts_at);

do $$
declare t text;
begin
  foreach t in array array['connector_links', 'canvas_announcements', 'assignment_plans', 'assignment_steps', 'study_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
