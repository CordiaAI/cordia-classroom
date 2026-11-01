-- Data for mcp_read_access_rls.sql, loaded BEFORE 20261101120000_mcp_read_access.sql so its
-- folder backfill has something to mark.
-- Class tables as the Canvas migration makes them (only the columns used here).
create table if not exists public.classes (id uuid primary key default gen_random_uuid(), course_code_normalized text, display_name text);
create table if not exists public.class_terms (id uuid primary key default gen_random_uuid(), class_id uuid references public.classes(id));
create table if not exists public.class_memberships (user_id uuid, class_term_id uuid references public.class_terms(id), source text);
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
insert into public.classes (id, course_code_normalized, display_name) values
  ('cccccccc-0000-0000-0000-000000000001', 'BIO 101', 'Biology'),
  ('cccccccc-0000-0000-0000-000000000002', 'HIST 210', 'Modern History') on conflict do nothing;
insert into public.class_terms (id, class_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.class_memberships (user_id, class_term_id, source) values
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'canvas'),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000002', 'manual');
insert into public.folders (id, user_id, name, class_id) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'BIO 101 Biology', 'cccccccc-0000-0000-0000-000000000001'),
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'HIST 210 Modern History', 'cccccccc-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Other student', null)
on conflict do nothing;
insert into public.study_guides (id, user_id, folder_id, title, notes, study_guide, flashcards, source_type, source_title, source_url) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', 'Cell biology', '## Cells' || chr(10) || '- The **mitochondria** makes ATP', 'Q1: What makes ATP?' || chr(10) || 'A1: Mitochondria',
   '[{"front":"What makes ATP?","back":"Mitochondria"},{"front":"Powerhouse of the cell","back":"Mitochondria"}]', 'canvas_module', 'BIO 101 · Module 3', 'https://school.instructure.com/x'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', null, 'Lab report: study guide', 'Mitochondria rubric notes', '', '[]', 'assignment', 'Lab report', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', null, 'Someone else mitochondria', 'mitochondria', '', '[]', 'file', null, null)
on conflict do nothing;
insert into public.smart_notes (id, user_id, title, content) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'My notes', '<p>Mitochondria have their own DNA</p>') on conflict do nothing;
insert into public.lectures (id, user_id, title, transcript, segments, analysis) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lecture 4', 'Today cells. The mitochondria is important for the exam.',
   '[{"start_ms":0,"text":"Today cells."},{"start_ms":95000,"text":"The mitochondria is important for the exam."}]', '{"summary":["Cells"]}') on conflict do nothing;
