-- Phase 0 live checks, read-only. Run after: one feedback sent with a screenshot, and one
-- multiple-choice answer in Quiz or Learn (both on the live app), then paste the row back.
select
  (select count(*) from public.feedback where jsonb_array_length(attachments) > 0) as feedback_with_screenshots,
  (select max(created_at) from public.feedback where jsonb_array_length(attachments) > 0) as last_screenshot_feedback,
  (select count(*) from public.learning_events where n_options is not null) as answers_with_choice_count,
  (select max(occurred_at) from public.learning_events where n_options is not null) as last_choice_answer,
  (select count(*) from public.decision_outcomes) as decision_outcomes,
  (select count(*) from public.decision_events where created_at < now() - interval '2 days') as decisions_older_than_2_days;
