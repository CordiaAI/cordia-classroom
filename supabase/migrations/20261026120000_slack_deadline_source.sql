-- Slack posts can suggest deadline changes too (NOT APPLIED: waiting for the owner's OK).
--
-- Phase 5: when a class or study-group Slack channel the student follows says a date moved,
-- Cordia records the same pending suggestion as for email (services.mail_watch.propose), with
-- source 'slack'. Until this runs, those suggestions are skipped (logged), nothing else changes.

alter table public.deadline_changes drop constraint if exists deadline_changes_source_check;
alter table public.deadline_changes
  add constraint deadline_changes_source_check check (source in ('gmail', 'outlook', 'canvas_announcement', 'slack'));
