-- Lecture recording (NOT APPLIED: waiting for the owner's OK; run on a dev/preview database first).
--
-- 1. Recording minutes are metered like other AI features: one usage_ledger row per minute of
--    audio per recording (request_key "<recording_id>:<minute>" makes retries free).
-- 2. "Keep audio": a private storage bucket. Only the backend (service role) reads or writes it;
--    students never get direct access, and nothing is stored unless they turn Keep audio on.

alter table public.usage_ledger drop constraint if exists usage_ledger_feature_check;
alter table public.usage_ledger add constraint usage_ledger_feature_check check (feature in
  ('guide', 'tutor', 'learn_my_way', 'practice', 'ai_quiz', 'nclex', 'exam', 'light', 'retain_types', 'lecture_minute'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lecture-audio', 'lecture-audio', false, 6291456,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'video/webm'])
on conflict (id) do nothing;

-- No storage.objects policies for this bucket: anon and authenticated users get nothing;
-- the service role used by the backend bypasses RLS.
