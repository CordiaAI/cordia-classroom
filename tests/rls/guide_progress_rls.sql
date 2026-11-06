-- Stage 4 (guide_progress / guide_versions / merge_guide_progress) on a local Postgres with the
-- Supabase stub and tests/rls/mcp_read_access_seed.sql loaded. Raises on the first failure.
do $$
declare
  owner_id uuid := '11111111-1111-1111-1111-111111111111';
  student uuid := '33333333-3333-3333-3333-333333333333';
  guide uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  p jsonb;
  r public.guide_progress%rowtype;
begin
  -- A first save creates the row at the version given; entries merge per idea.
  p := public.merge_guide_progress(student, guide, '{"abc123def0":{"box":1,"due":"2026-11-10","known":true}}', 3,
    '{"value":"2026-12-01"}', '{"value":"essay"}');
  if p -> 'abc123def0' ->> 'box' <> '1' then raise exception 'first save: %', p; end if;
  p := public.merge_guide_progress(student, guide, '{"0011223344":{"l":2,"at":"2026-11-06","q":"what makes atp"}}', 9, null, null);
  select * into r from public.guide_progress where user_id = student and guide_id = guide;
  if r.version_seen <> 3 then raise exception 'version changed by a save: %', r.version_seen; end if;
  if not (r.progress ? 'abc123def0' and r.progress ? '0011223344') then raise exception 'merge lost an idea: %', r.progress; end if;
  -- Fields merge within an idea; a null clears one.
  p := public.merge_guide_progress(student, guide, '{"abc123def0":{"l":1,"q":"x","known":null}}', 1, null, null);
  if p -> 'abc123def0' ->> 'box' <> '1' or p -> 'abc123def0' ->> 'l' <> '1' or p -> 'abc123def0' ? 'known' then raise exception 'field merge: %', p; end if;
  if r.test_date <> '2026-12-01' or r.test_format <> 'essay' then raise exception 'test kept: % %', r.test_date, r.test_format; end if;
  -- Clearing the date, an invalid format keeps the saved one.
  perform public.merge_guide_progress(student, guide, '{}', 1, '{"value":null}', '{"value":"nonsense"}');
  select * into r from public.guide_progress where user_id = student and guide_id = guide;
  if r.test_date is not null or r.test_format <> 'essay' then raise exception 'test update: % %', r.test_date, r.test_format; end if;
  -- Bad keys and entries are refused.
  begin
    perform public.merge_guide_progress(student, guide, '{"BAD KEY":{}}', 1, null, null);
    raise exception 'bad key accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.merge_guide_progress(student, guide, '{"abc123def0":5}', 1, null, null);
    raise exception 'non-object entry accepted';
  exception when sqlstate '22023' then null;
  end;
  -- The owner's guide row is never touched.
  if (select flashcard_progress from public.study_guides where id = guide) ? 'abc123def0' then raise exception 'owner row written'; end if;
  -- Versions store cards, quiz and Q/A; one row per version.
  insert into public.guide_versions (guide_id, version, title, cards, quiz, qa) values (guide, 3, 'T', '[{"front":"Q","back":"A","idea_id":"abc123def0"}]', null, '[]')
  on conflict (guide_id, version) do update set title = excluded.title;
  -- Browser roles can't reach any of it.
  if has_table_privilege('authenticated', 'public.guide_progress', 'SELECT') or has_table_privilege('anon', 'public.guide_progress', 'SELECT')
    or has_table_privilege('authenticated', 'public.guide_versions', 'SELECT')
    or has_function_privilege('authenticated', 'public.merge_guide_progress(uuid,uuid,jsonb,integer,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.merge_guide_progress(uuid,uuid,jsonb,integer,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'browser roles can reach guide_progress';
  end if;
  -- Deleting the guide removes its progress and versions.
  delete from public.guide_versions where guide_id = guide;
  delete from public.guide_progress where guide_id = guide;
end $$;
select 'GUIDE PROGRESS RLS OK';
