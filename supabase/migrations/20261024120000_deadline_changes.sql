-- Deadline changes found in email and Canvas announcements (NOT APPLIED: waiting for the owner's OK).
--
-- Phase 3: when a professor, TA or school address emails something like "the exam moved to
-- Thursday" or "you have an extension to Monday" (or a Canvas announcement says a date moved),
-- Cordia records a suggested change here. Nothing moves until the student confirms it on the
-- Dashboard; then the assignment's due date, its Google Task, step dates and study blocks follow.
--
-- Source of truth: Canvas still owns due dates. An accepted change is the student's own override
-- and holds until Canvas itself changes that assignment's date after the change was accepted.
-- Only the extracted change is stored (sender, a one-line summary, the dates), never the email body.

create table if not exists public.deadline_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('gmail', 'outlook', 'canvas_announcement')),
  source_id text not null check (char_length(source_id) between 1 and 300),
  -- The deadline it changes ('canvas-123'); empty when it names work Cordia couldn't match.
  item_key text not null default '' check (char_length(item_key) <= 200),
  kind text not null check (kind in ('moved', 'extension', 'cancelled')),
  title text not null default '' check (char_length(title) <= 300),
  summary text not null default '' check (char_length(summary) <= 600),
  sender text not null default '' check (char_length(sender) <= 300),
  old_due timestamptz,
  new_due timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_id, item_key)
);
create index if not exists deadline_changes_user_status_idx on public.deadline_changes (user_id, status, created_at desc);

alter table public.deadline_changes enable row level security;
revoke all on table public.deadline_changes from public, anon, authenticated;
grant select, insert, update, delete on table public.deadline_changes to service_role;
