-- Visuals a student keeps in a guide's Outline (NOT APPLIED: waiting for the owner's OK; run after
-- 20261016130000_napkin_visuals.sql).
--
-- Highlight text in the Outline -> Visualize -> three Napkin versions appear beside it -> the one
-- the student keeps is saved here and shows beside that section every time the guide opens.
-- The images themselves are already in the public "visuals" bucket; this only records which one
-- sits where. Only the web server (service role) reads or writes it, after checking through the
-- Classroom API that the guide is the student's own. Until this runs, kept visuals are saved in
-- the browser instead.

create table if not exists public.guide_visuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid not null references public.study_guides (id) on delete cascade,
  section text not null default '' check (char_length(section) <= 500),
  anchor text not null default '' check (char_length(anchor) <= 600),
  url text not null check (char_length(url) <= 1000),
  alt text not null default '' check (char_length(alt) <= 500),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  created_at timestamptz not null default now()
);
create index if not exists guide_visuals_guide_idx on public.guide_visuals (user_id, guide_id, created_at);
alter table public.guide_visuals enable row level security;
revoke all on public.guide_visuals from anon, authenticated;
-- No policies: students never read or write it directly.
