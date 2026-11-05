-- Personalization plan, step 0.3: what happened after each adaptive decision.
-- NOT APPLIED: waiting for the owner's OK. Run on a preview database first.
--
-- Fields from docs/research/08-adaptive-algorithms.md ("Core schema"). One row per decision and
-- outcome type, written by the backend's nightly job (services/decision_outcomes.py):
-- - delayed_recall: the next first-try-of-the-day recall answer (typed, free fill-in, written) on
--   the same idea at least a day later. value 1 right, 0.5 partly right, 0 wrong; a correct answer
--   marked "Guess" is 0 (it isn't a recall win, owner decision G1).
-- - returned_within_48h: 1 if the student answered anything 6 to 48 hours after the decision, else 0.
-- - sms_converted_2h: reserved for the Assistant's text decisions (not logged yet).
-- p_pred (FSRS's predicted recall) and residual (value - p_pred) stay null until Phase 2.
-- Service role only: students and connected apps never read or write it.

create table if not exists public.decision_outcomes (
  id bigserial primary key,
  decision_id uuid not null references public.decision_events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  outcome_type text not null check (outcome_type in ('delayed_recall', 'returned_within_48h', 'sms_converted_2h')),
  value real not null check (value between 0 and 1),
  p_pred real check (p_pred between 0 and 1),
  residual real,
  learning_event_id bigint references public.learning_events on delete set null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (decision_id, outcome_type)
);
create index if not exists decision_outcomes_user_idx on public.decision_outcomes (user_id, observed_at);

alter table public.decision_outcomes enable row level security;
revoke all on public.decision_outcomes from anon, authenticated;
