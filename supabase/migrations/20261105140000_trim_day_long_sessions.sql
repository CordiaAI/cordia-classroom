-- Trim the 17 day-long study sessions logged before the idle fix (Oct 31) to 3 hours.
-- NOT APPLIED: waiting for the owner's OK.
--
-- Before the fix, a tab left open could log a session of 24 hours. The app already caps every
-- session at 3 hours when it reads them (backend/routers/stats.py MAX_SESSION_SECONDS), so totals
-- shown today don't change; this makes the stored rows match. Each trimmed row keeps its original
-- length in metadata.trimmed_from_seconds, so it can be put back:
--   update public.study_sessions set duration_seconds = (metadata->>'trimmed_from_seconds')::int,
--     ended_at = started_at + make_interval(secs => (metadata->>'trimmed_from_seconds')::int),
--     metadata = metadata - 'trimmed_from_seconds' where metadata ? 'trimmed_from_seconds';
-- study_days (the per-day active minutes) is a separate log capped at 1440 and isn't touched.
-- Only rows of 86000 s or more (the day-long ones, 17 on 2026-11-05) change.

update public.study_sessions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('trimmed_from_seconds', duration_seconds),
    duration_seconds = 10800,
    ended_at = started_at + interval '3 hours'
where duration_seconds >= 86000;
