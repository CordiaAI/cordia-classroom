-- Personalization plan, step 0.2: how many choices a multiple-choice or matching answer had.
-- NOT APPLIED: waiting for the owner's OK. Run on a preview database first.
--
-- A right answer out of 2 choices says less than one out of 5, so the count is kept with the answer.
-- Null for formats with no choices (typed, written, fill, flashcards, practice).
-- The backend leaves the column out of a batch that has no choice answers (a connected app's
-- answers never do), and retries without it until this migration has run, so logging never stops.

alter table public.learning_events add column if not exists n_options smallint
  check (n_options is null or n_options between 2 and 50);

-- A connected app's answers are written as the student (services/learning_events.write_batch).
grant insert (n_options) on public.learning_events to mcp_client;
