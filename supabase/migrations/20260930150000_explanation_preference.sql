-- How the student asked the Tutor to explain things, in their own words.
-- A presentation preference only: it never changes facts or the Tutor's rules.
alter table public.learning_preferences
  add column if not exists explain_preference text check (char_length(explain_preference) <= 500);
