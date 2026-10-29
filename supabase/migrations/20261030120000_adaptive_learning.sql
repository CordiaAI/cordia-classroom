-- Adaptive learning (NOT APPLIED: waiting for the owner's OK; run on a dev/preview database first).
--
-- "Cordia learns how you learn": the data the engine keeps per student.
-- 1. learning_events: one row per answer in Learn, Quiz, Flashcards, Study now, timed tests and
--    Practice. Append-only. It is how the engine sees which formats and explanations lead to
--    answers that are still right days later.
-- 2. item_memory: one row per idea a student has studied: how well it is remembered (FSRS
--    stability and difficulty) and when it is next due. One record per idea, shared by every
--    study mode.
-- 3. learner_profile: one row per student: the engine's estimates (format and explanation
--    effectiveness, confidence calibration, best session length and time of day), each with
--    how much evidence backs it, plus the student's off switch.
-- An idea is a guide plus a question fingerprint (learnEngine.fingerprint: the first 48
-- characters of the question, lower-cased), so progress follows the question, not its position.
-- Only the backend (service role) reads or writes these tables, always filtered to the
-- signed-in student; students never get direct access. Deleting the account or the guide
-- deletes the rows.

create table if not exists public.learning_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid not null references public.study_guides (id) on delete cascade,
  item text not null check (char_length(item) between 1 and 64),
  mode text not null check (mode in ('learn', 'quiz', 'flashcards', 'study_now', 'timed_test', 'practice')),
  format text not null check (format in ('mc', 'fill', 'written', 'self', 'flip', 'match', 'practice')),
  credit real not null check (credit >= 0 and credit <= 1),   -- 1 right, 0.5 partly right, 0 wrong
  recall boolean not null default false,                     -- typed or said from memory, not picked
  confidence text check (confidence in ('sure', 'think', 'guess')),
  latency_ms integer check (latency_ms >= 0),
  view text,                                                 -- Explain view seen before this answer
  repeat boolean not null default false,                     -- asked again in the same round after a miss
  session_id uuid,
  answered_at timestamptz not null default now()
);
create index if not exists learning_events_user_idx on public.learning_events (user_id, answered_at desc);
create index if not exists learning_events_item_idx on public.learning_events (user_id, guide_id, item, answered_at);
alter table public.learning_events enable row level security;
revoke all on public.learning_events from anon, authenticated;

create table if not exists public.item_memory (
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid not null references public.study_guides (id) on delete cascade,
  item text not null check (char_length(item) between 1 and 64),
  stability real not null check (stability > 0),            -- days until recall falls to 90%
  difficulty real not null check (difficulty between 1 and 10),
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  last_review timestamptz not null default now(),
  due_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, guide_id, item)
);
create index if not exists item_memory_due_idx on public.item_memory (user_id, due_at);
alter table public.item_memory enable row level security;
revoke all on public.item_memory from anon, authenticated;

create table if not exists public.learner_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  estimates jsonb not null default '{}'::jsonb,
  adapt boolean not null default true,                       -- the student's "adapt to me" switch
  events_seen integer not null default 0 check (events_seen >= 0),
  updated_at timestamptz not null default now()
);
alter table public.learner_profile enable row level security;
revoke all on public.learner_profile from anon, authenticated;
-- No policies on any of the three tables: no direct student access.
