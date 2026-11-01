-- Run after supabase_stub.sql, the lockdown and connected-apps migrations, mcp_read_access_seed.sql
-- and 20261101120000_mcp_read_access.sql (twice). Raises on any failure.
-- Backfill and renames: an untouched Canvas-named folder is lms_named; a manual class keeps its name.
do $$ begin
  if not (select lms_named from public.folders where id = 'ffffffff-0000-0000-0000-000000000001') then raise exception 'Canvas folder not marked'; end if;
  if (select lms_named from public.folders where id = 'ffffffff-0000-0000-0000-000000000002') then raise exception 'manual class marked'; end if;
  if (select own_name from public.folders where id = 'ffffffff-0000-0000-0000-000000000001') is not null then raise exception 'own_name shows the Canvas name'; end if;
end $$;

-- As the connected app.
set role mcp_client;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare n int;
begin
  select count(*) into n from public.study_guides;
  if n <> 1 then raise exception 'connected app sees % guides (expected 1: own, not the assignment one)', n; end if;
  begin
    perform source_title from public.study_guides;
    raise exception 'source_title readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform name from public.folders;
    raise exception 'folders.name readable';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.folders) <> 2 then raise exception 'folder isolation broken'; end if;
  -- Search: own guide, cards, note and lecture (with the timestamp); never the other student's.
  if (select count(*) from public.search_my_materials('mitochondria')) < 4 then raise exception 'search found too little'; end if;
  if exists (select 1 from public.search_my_materials('mitochondria', null, null, 50) where id in ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002')) then raise exception 'search crossed students or showed an assignment guide'; end if;
  if (select timestamp_seconds from public.search_my_materials('mitochondria', null, array['lecture'])) <> 95 then raise exception 'lecture timestamp wrong'; end if;
  if (select count(*) from public.search_my_materials('mitochondria', null, array['flashcard'])) <> 2 then raise exception 'flashcard search wrong'; end if;
  if exists (select 1 from public.search_my_materials('mitochondria', 'ffffffff-0000-0000-0000-000000000002')) then raise exception 'course filter ignored'; end if;
  begin
    perform public.set_my_timezone('America/New_York');
    raise exception 'connected app set the time zone';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- As the student's app sign-in.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.set_my_timezone('America/Chicago');
  begin
    perform public.set_my_timezone('Mars/Olympus');
    raise exception 'bad time zone saved';
  exception when invalid_parameter_value then null;
  end;
  insert into public.retain_misses (user_id, guide_id, items) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', '[{"question":"What makes ATP?","answer":"Mitochondria","sure":true}]');
  begin
    insert into public.retain_misses (user_id, guide_id, items) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', '[]');
    raise exception 'saved misses on another student''s guide';
  exception when insufficient_privilege then null;
  end;
  insert into public.study_days (user_id, day, minutes, cards) values ('11111111-1111-1111-1111-111111111111', '2026-10-30', 12.5, 20);
  -- A rename makes the folder's name the student's own.
  update public.folders set name = 'Bio (mine)' where id = 'ffffffff-0000-0000-0000-000000000001';
  if (select own_name from public.folders where id = 'ffffffff-0000-0000-0000-000000000001') <> 'Bio (mine)' then raise exception 'rename not kept'; end if;
end $$;
reset role;
do $$ begin
  if (select timezone from public.user_profiles where id = '11111111-1111-1111-1111-111111111111') <> 'America/Chicago' then raise exception 'time zone not saved'; end if;
end $$;

-- The connected app reads what the app saved.
set role mcp_client;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select timezone from public.user_profiles) <> 'America/Chicago' then raise exception 'time zone unreadable'; end if;
  if (select count(*) from public.retain_misses) <> 1 or (select count(*) from public.study_days) <> 1 then raise exception 'misses or study days unreadable'; end if;
  begin
    insert into public.study_days (user_id, day) values ('11111111-1111-1111-1111-111111111111', '2026-10-31');
    raise exception 'connected app wrote a study day';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if (select count(*) from public.retain_misses) <> 0 or (select count(*) from public.study_days) <> 0 then raise exception 'another student''s data visible'; end if;
end $$;
reset role;
select 'READ ACCESS OK';
