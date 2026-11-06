-- NOT APPLIED: waiting for owner's OK. Learn format ladder (LEARN_LADDER_V2), Change 5.
--
-- Extra study fields on each answer, for the owner only (never shown to students):
--   first_try, gap (questions since the idea was last asked), level_before, level_after,
--   test_format, days_to_test, fallback (a free plan's Written instead of Fill in the blank),
--   practice (final-days practice that can't master).
-- User, guide, question fingerprint, format, outcome, confidence and time are already columns.
-- Written by backend/services/learning_events.py only while LEARNING_EVENTS_ENABLED is on; until this
-- runs, answers are logged without these fields (the insert retries without the column).
--
-- Rollback:
--   alter table public.learning_events drop constraint if exists learning_events_detail_size;
--   alter table public.learning_events drop column if exists detail;

alter table public.learning_events add column if not exists detail jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'learning_events_detail_size') then
    alter table public.learning_events add constraint learning_events_detail_size
      check (detail is null or (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000));
  end if;
end $$;
