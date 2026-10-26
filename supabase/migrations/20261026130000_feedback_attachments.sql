-- Screenshots on feedback (NOT APPLIED: waiting for the owner's OK).
--
-- The feedback dialog lets a student attach up to 3 screenshots or photos. The browser shrinks
-- each to at most 2000px; the web server (pages/api/feedback-attachment.js, service role) checks
-- the student and stores it privately at <user id>/<random>.<ext>. The feedback row keeps the
-- paths; the review page gets short-lived signed links from the backend. Private bucket and no
-- policies: only the service role reads or writes. Until this runs, feedback still sends without
-- screenshots (the dialog says screenshots aren't set up yet).

alter table public.feedback add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
