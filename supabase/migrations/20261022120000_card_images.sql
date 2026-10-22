-- Photos on flashcards (NOT APPLIED: waiting for the owner's OK).
--
-- A student adds a photo to the front or back of a card (Create page and the guide's New card
-- sheet). The browser shrinks it to at most 1600px, the web server (pages/api/card-image.js, service
-- role) checks the student through the Classroom API and stores it at <user id>/<random>.<ext>, and
-- the card keeps the public URL (flashcards[].image / front_image). Public read, so cards shared
-- with a class show the photo; no policies, so only the service role writes or deletes.
-- Deleting an account removes the user's folder (backend/routers/auth.py).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
