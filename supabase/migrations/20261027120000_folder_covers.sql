-- A class's cover in Library's card view: a Napkin visual of the class's topics, or one the
-- student redrew or described. { url, alt, text, redraw }; null shows the plain placeholder.
alter table public.folders add column if not exists cover jsonb;
