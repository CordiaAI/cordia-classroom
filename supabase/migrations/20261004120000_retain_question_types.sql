-- Retain question types: Pro sessions (matching, fill in the blank) are metered like other
-- Pro study tools. Widens the allowed usage_ledger features; existing rows are unaffected.
alter table public.usage_ledger drop constraint if exists usage_ledger_feature_check;
alter table public.usage_ledger add constraint usage_ledger_feature_check check (feature in
  ('guide', 'tutor', 'learn_my_way', 'practice', 'ai_quiz', 'nclex', 'exam', 'light', 'retain_types'));
