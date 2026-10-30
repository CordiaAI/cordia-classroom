-- Applied after the stack is up (Storage creates its tables on boot).
insert into storage.buckets (id, name, public) values ('card-images', 'card-images', false) on conflict do nothing;
create policy "fixture own objects" on storage.objects for all to authenticated
  using (bucket_id = 'card-images' and owner = auth.uid()) with check (bucket_id = 'card-images' and owner = auth.uid());

alter publication supabase_realtime add table public.study_guides, public.canvas_courses;
