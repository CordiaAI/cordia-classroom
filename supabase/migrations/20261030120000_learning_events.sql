-- Adaptive learning engine, phase 1: honest logging.
-- NOT APPLIED: waiting for owner's OK. Run on a dev/preview database first.
--
-- From the build spec's "Draft migrations" section; only the four phase 1 tables (item_memory,
-- fsrs_params, recall_probes and exam_targets come with phase 2).
-- 1. policy_versions: the rules behind every adaptive choice, so each decision names its policy.
-- 2. decision_events: one row per adaptive choice (today: Learn's question format), with the
--    candidates, why some were ruled out, and the probability of the one chosen.
-- 3. learning_events: every answer in every study mode, append-only, raw values only. Ratings,
--    rapid-guess flags and FSRS state are derived later.
-- 4. learner_settings: the student's switches for adaptation. Students may read their own row.
-- The backend writes with the service role. An idea is item_id '<guide_id>:<fingerprint>', the
-- fingerprint being Learn's (web/lib/learnEngine.mjs fingerprint): the question's first 48
-- characters, lower-cased, so progress follows the question rather than its position.

-- Versioned policies, so every decision says which rules made it
create table if not exists public.policy_versions (
  id text primary key,                         -- e.g. 'format-rules-v0'
  decision_type text not null check (decision_type in
    ('format', 'explain_view', 'round_size', 'session_length', 'sms')),
  stage smallint not null,
  epsilon numeric(4,3) not null check (epsilon <= 0.10),
  params jsonb not null,
  code_sha text not null,
  created_at timestamptz not null default now()
);

-- One row per adaptive decision, written before the student sees it
create table if not exists public.decision_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid,
  item_id text,                                -- '<guide_id>:<fingerprint>', null for SMS
  decision_type text not null,
  policy_version_id text not null references public.policy_versions,
  source text not null check (source in ('policy', 'explore', 'student', 'rule')),
  candidates jsonb not null,
  mask_reasons jsonb not null,
  eligible jsonb not null,
  probs jsonb not null,
  chosen text not null,
  propensity double precision not null check (propensity > 0 and propensity <= 1),
  seed bigint not null,
  context jsonb not null,                      -- level, minutes in session, days to exam, subject, device, local hour
  fsrs_before jsonb,
  created_at timestamptz not null default now()
);
create index if not exists decision_events_user_idx on public.decision_events (user_id, created_at);

-- Every answer, append-only
create table if not exists public.learning_events (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null,
  guide_id uuid not null,
  decision_id uuid references public.decision_events,
  mode text not null,                          -- learn, quiz, check, match, timed_test, flashcards, study_now, practice, nclex, probe
  format text not null check (format in
    ('choice', 'typed', 'written', 'flashcard', 'fill_bank', 'fill_free', 'pairs', 'practice')),
  outcome text not null,                       -- right, partly, wrong, got_it, again
  confidence text check (confidence in ('sure', 'think_so', 'guess')),
  first_key_ms integer,
  submit_ms integer,
  hidden_ms integer not null default 0,        -- time the tab was hidden
  rapid_guess boolean not null default false,
  answer_chars integer,
  view_shown text,
  fsrs_rating smallint,                        -- 1-4, null when log-only
  same_day boolean not null,
  arm text not null default 'fsrs' check (arm in ('fsrs', 'holdout')),
  params_version text not null,
  s_before real, d_before real, r_before real,
  occurred_at timestamptz not null default now()
);
create index if not exists learning_events_item_idx on public.learning_events (user_id, item_id, occurred_at);

create table if not exists public.learner_settings (
  user_id uuid primary key references auth.users on delete cascade,
  adaptation_on boolean not null default true,
  exploration_on boolean not null default true,
  use_speed boolean not null default true,
  first_view_pref text,                        -- explicit choice, always wins
  study_preference text,                       -- 'How do you like to study?' answer
  updated_at timestamptz not null default now()
);

-- Row-level security on all four. No policies except learner_settings: students read their own
-- row; everything else is written and read by the backend only.
alter table public.policy_versions enable row level security;
alter table public.decision_events enable row level security;
alter table public.learning_events enable row level security;
alter table public.learner_settings enable row level security;
revoke all on public.policy_versions, public.decision_events, public.learning_events, public.learner_settings
  from anon, authenticated;
grant select on public.learner_settings to authenticated;
drop policy if exists "Students read their own learner settings" on public.learner_settings;
create policy "Students read their own learner settings" on public.learner_settings
  for select to authenticated using (auth.uid() = user_id);

-- The phase 1 format policy: Learn's fixed rule ladder (web/lib/learnEngine.mjs askCard), no
-- exploration. Every decision logged in phase 1 names it.
insert into public.policy_versions (id, decision_type, stage, epsilon, params, code_sha)
values ('format-rules-v0', 'format', 0, 0,
  '{"rules": "recognise first while New or Learning; recall once Familiar, Mastered or fading; short answers typed, long ones written; the student''s picks only", "exploration": 0}'::jsonb,
  'learnEngine.askCard (phase 1)')
on conflict (id) do nothing;
