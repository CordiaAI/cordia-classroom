-- Quiz feedback timing and printable quizzes.
-- NOT APPLIED: waiting for the owner's OK. Run after 20261109130000_guide_visibility_backfill.sql.
--
-- 1. quiz_attempts.metadata: how an attempt was taken. {"feedback": "each" | "submit"} plus, for
--    "submit", the retry round's result ({"retry": {"cleared": n, "of": n}}). quiz_attempts had no
--    JSON column for this; the score columns stay first-try only, as today. Written by the backend
--    (service role) only. Connected apps already read the rest of the row, so they read this too.
-- 2. study_guides.print_items: the printable-quiz items built from the guide's own Q/A, cached per
--    type ({"v": 1, "source": "<hash of the Q/A>", "matching": [...], "fill": [...], "short": [...]})
--    so changing the format or reprinting reuses them and only a missing type is generated. Read and
--    written by the backend only; not granted to connected apps.

alter table public.quiz_attempts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.quiz_attempts
    add constraint quiz_attempts_metadata_size check (pg_column_size(metadata) <= 4000);
exception when duplicate_object then null; end $$;

grant select (metadata) on public.quiz_attempts to mcp_client;

alter table public.study_guides
  add column if not exists print_items jsonb;

do $$ begin
  alter table public.study_guides
    add constraint study_guides_print_items_size check (print_items is null or pg_column_size(print_items) <= 262144);
exception when duplicate_object then null; end $$;
