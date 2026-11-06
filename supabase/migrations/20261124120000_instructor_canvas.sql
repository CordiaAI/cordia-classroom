-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 8: "Let classmates from my courses find me".
--
-- user_profiles.find_by_classmates: whether people in the student's courses this term may see them
-- in "Classmates from Canvas" (GET /classrooms/suggestions). Null means the default: on for adults,
-- off for minors (services/classmates.py findable). Written only by the backend (PATCH /profiles/me).
-- Until this is applied, everyone gets the default and the toggle answers "isn't available yet".
--
-- "Who else takes this course this term" uses the existing class_memberships_term_idx.
--
-- Check afterwards:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'user_profiles' and column_name = 'find_by_classmates';     -- boolean, YES
--
-- Rollback:
-- alter table public.user_profiles drop column if exists find_by_classmates;

alter table public.user_profiles add column if not exists find_by_classmates boolean;
