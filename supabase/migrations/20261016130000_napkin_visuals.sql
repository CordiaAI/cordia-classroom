-- Napkin AI visuals (NOT APPLIED: waiting for the owner's OK; run on a dev/preview database first,
-- after 20261016120000_lecture_recording.sql).
--
-- 1. Visuals are metered like other AI features: Free 10 and Pro 200 a month, one usage_ledger
--    row per generated visual request (request_key "visual:<cache key>" makes retries free).
-- 2. visual_cache: one row per hash of (text + context + style + theme), so the same section never
--    costs twice. Only the web server (service role) reads or writes it.
-- 3. note_covers: each note's Napkin cover graphic (one per note, remade when the note grows).
--    Only the web server (service role) reads or writes it; it returns a student's own covers.
-- 4. "visuals" bucket: the SVGs downloaded from Napkin right after generation (Napkin's own links
--    expire after 30 minutes and are never hotlinked). Public read so <img> tags and saved notes
--    work without signed URLs; paths are 64-character content hashes, never listed.

alter table public.usage_ledger drop constraint if exists usage_ledger_feature_check;
alter table public.usage_ledger add constraint usage_ledger_feature_check check (feature in
  ('guide', 'tutor', 'learn_my_way', 'practice', 'ai_quiz', 'nclex', 'exam', 'light', 'retain_types', 'lecture_minute', 'visual'));

create table if not exists public.visual_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users (id) on delete set null,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  alt text not null default '',
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.visual_cache enable row level security;
revoke all on public.visual_cache from anon, authenticated;
-- No policies: students never read or write the cache directly.

create table if not exists public.note_covers (
  note_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  alt text not null default '',
  content_length integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists note_covers_user_idx on public.note_covers (user_id);
alter table public.note_covers enable row level security;
revoke all on public.note_covers from anon, authenticated;
-- No policies: students never read or write it directly.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visuals', 'visuals', true, 2097152, array['image/svg+xml'])
on conflict (id) do nothing;
-- No storage.objects policies: only the service role uploads; public read comes from the bucket flag.
