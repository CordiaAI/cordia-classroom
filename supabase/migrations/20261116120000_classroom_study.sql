-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 6: studying a whole classroom.
--
-- One column: a member's own test date for a classroom (its Study tab and readiness). Without it the
-- nearest milestone is used, and a date the student picks is kept on their device only.
--
-- Check afterwards:
--   select column_name from information_schema.columns
--    where table_name = 'classroom_members' and column_name = 'study_test_date';   -- 1 row
--
-- Rollback:
-- alter table public.classroom_members drop column if exists study_test_date;

alter table public.classroom_members add column if not exists study_test_date date;
