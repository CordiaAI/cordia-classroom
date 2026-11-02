-- Run after supabase_stub.sql, the lockdown and connected-apps migrations, mcp_read_access_seed.sql,
-- 20261101120000_mcp_read_access.sql and 20261102120000_mcp_write_tools.sql (twice). Raises on any failure.
insert into auth.oauth_clients (id, client_name) values ('99999999-0000-0000-0000-000000000001', 'Claude') on conflict do nothing;
update public.study_guides set
  practice_state = '{"problems":[{"prompt":"2+2","answer":"4"}],"progress":{"evaluations":{}}}',
  quiz_questions = '[{"question":"What makes ATP?","answer":"Mitochondria"}]'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- The app's save: only the cards and ideas it sends change, under the row lock.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}';
do $$
declare p jsonb;
begin
  p := public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', '{"0":{"box":1,"due":"2026-11-04","known":true}}');
  if p -> 'schedule' -> '0' ->> 'box' <> '1' or p -> 'known' <> '[0]'::jsonb then raise exception 'first merge wrong: %', p; end if;
  p := public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', '{"1":{"box":0,"due":"2026-11-03","known":false}}',
    '{"levels":{"0":{"l":2,"at":"2026-11-02","q":"what makes atp"}},"test_date":"2026-12-01"}');
  if p -> 'schedule' -> '0' ->> 'box' <> '1' then raise exception 'second merge erased the first card: %', p; end if;
  if p -> 'unknown' <> '[1]'::jsonb or p -> 'learn' -> 'levels' -> '0' ->> 'l' <> '2' or p -> 'learn' ->> 'test_date' <> '2026-12-01' then raise exception 'second merge wrong: %', p; end if;
  -- A later Learn save keeps the test date it didn't mention.
  p := public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', null, '{"levels":{"0":{"l":3,"at":"2026-11-02","q":"what makes atp","sure":true}}}');
  if p -> 'learn' ->> 'test_date' <> '2026-12-01' or p -> 'learn' -> 'levels' -> '0' ->> 'sure' <> 'true' then raise exception 'learn merge wrong: %', p; end if;
  begin
    perform public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', '{"7":{"box":1,"due":"2026-11-04","known":true}}');
    raise exception 'saved a card that does not exist';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', '{"0":{"box":9,"due":"2026-11-04","known":true}}');
    raise exception 'saved box 9';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000003', '{"0":{"box":1,"due":"2026-11-04","known":true}}');
    raise exception 'saved progress on another student''s guide';
  exception when no_data_found then null;
  end;
  begin
    perform public.mcp_record_answer('k', 'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'an app sign-in ran a connected-app function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- As the connected app.
set role mcp_client;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claims = '{"role":"mcp_client","sub":"11111111-1111-1111-1111-111111111111","client_id":"99999999-0000-0000-0000-000000000001"}';
do $$
declare r jsonb; made uuid; n int; i int; ok boolean;
begin
  begin
    perform public.merge_study_progress('aaaaaaaa-0000-0000-0000-000000000001', '{"0":{"box":5,"due":"2026-12-04","known":true}}');
    raise exception 'connected app used the app''s raw progress save';
  exception when insufficient_privilege then null;
  end;

  -- One answer, recorded once however often it is sent.
  r := public.mcp_record_answer('answer-1', 'aaaaaaaa-0000-0000-0000-000000000001',
    '{"1":{"box":1,"due":"2026-11-04","known":true}}', null,
    '[{"question":"Powerhouse of the cell","answer":"Mitochondria","sure":true}]', null,
    '{"day":"2026-11-02","minutes":0,"cards":1,"right_count":1,"total":1,"guides":{}}', '{"next_due_on":"2026-11-04"}');
  if r ->> 'replayed' <> 'false' or r ->> 'next_due_on' <> '2026-11-04' then raise exception 'first answer: %', r; end if;
  r := public.mcp_record_answer('answer-1', 'aaaaaaaa-0000-0000-0000-000000000001',
    '{"1":{"box":2,"due":"2026-11-06","known":true}}', null, null, null,
    '{"day":"2026-11-02","minutes":0,"cards":2,"right_count":2,"total":2,"guides":{}}', '{"next_due_on":"2026-11-06"}');
  if r ->> 'replayed' <> 'true' or r ->> 'next_due_on' <> '2026-11-04' then raise exception 'repeat not replayed: %', r; end if;
  if (select flashcard_progress -> 'schedule' -> '1' ->> 'box' from public.study_guides where id = 'aaaaaaaa-0000-0000-0000-000000000001') <> '1' then raise exception 'repeat counted twice'; end if;
  if (select cards from public.study_days where day = '2026-11-02') <> 1 then raise exception 'study day counted twice'; end if;
  if (select items -> 0 ->> 'sure' from public.retain_misses where guide_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 'true' then raise exception 'miss not kept'; end if;
  if (select flashcard_progress -> 'learn' ->> 'test_date' from public.study_guides where id = 'aaaaaaaa-0000-0000-0000-000000000001') <> '2026-12-01' then raise exception 'answer lost Learn'; end if;

  -- A practice problem's result.
  perform public.mcp_record_answer('answer-2', 'aaaaaaaa-0000-0000-0000-000000000001', practice => '{"index":0,"status":"correct","message":"Checked in Claude"}');
  if (select practice_state -> 'progress' -> 'evaluations' -> '0' ->> 'status' from public.study_guides where id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 'correct' then raise exception 'practice result not saved'; end if;
  begin
    perform public.mcp_record_answer('answer-3', 'aaaaaaaa-0000-0000-0000-000000000001', practice => '{"index":4,"status":"correct"}');
    raise exception 'saved a practice problem that does not exist';
  exception when no_data_found then null;
  end;

  -- Someone else's guide, an assignment guide and a guide that doesn't exist all look the same.
  foreach made in array array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000ff']::uuid[] loop
    begin
      perform public.mcp_record_answer('x-' || made, made, '{"0":{"box":1,"due":"2026-11-04","known":true}}');
      raise exception 'answer saved on %', made;
    exception when no_data_found then null;
    end;
    begin
      perform public.mcp_add_flashcards(made, '[{"front":"a","back":"b"}]');
      raise exception 'cards added to %', made;
    exception when no_data_found then null;
    end;
  end loop;

  -- Cards are appended; exact duplicates (ignoring case and spaces) are skipped.
  r := public.mcp_add_flashcards('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"front":"what makes ATP? ","back":"mitochondria"},{"front":"Krebs cycle","back":"Citric acid cycle"},{"front":"Krebs cycle","back":"Citric acid cycle"}]');
  if r ->> 'added_count' <> '1' or r ->> 'skipped_duplicates' <> '2' or r -> 'card_indexes' <> '[2]'::jsonb then raise exception 'add cards: %', r; end if;
  if (select flashcards -> 2 ->> 'added_by' from public.study_guides where id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 'Claude' then raise exception 'card not labelled'; end if;
  if (select flashcards -> 0 ->> 'front' from public.study_guides where id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 'What makes ATP?' then raise exception 'existing card changed'; end if;
  begin
    perform public.mcp_add_flashcards('aaaaaaaa-0000-0000-0000-000000000001', '[]');
    raise exception 'empty card list accepted';
  exception when invalid_parameter_value then null;
  end;

  -- A note is a new page, labelled with the app's name.
  made := public.mcp_save_note('Exam prep', '## Cells' || chr(10) || '- ATP comes from the **mitochondria**', 'ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
  if (select count(*) from public.study_guides where id = made and source_type = 'notes') <> 1 then raise exception 'note not saved as a page'; end if;
  begin
    perform public.mcp_save_note('Exam prep', 'text', 'ffffffff-0000-0000-0000-000000000003');
    raise exception 'note filed in another student''s course';
  exception when no_data_found then null;
  end;

  -- Study-set jobs: checked input, at most three at once.
  begin
    perform public.queue_study_set_job('text', 'too short');
    raise exception 'short text queued';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.queue_study_set_job('url', null, 'ftp://example.com/x');
    raise exception 'ftp link queued';
  exception when invalid_parameter_value then null;
  end;
  for i in 1..3 loop
    made := public.queue_study_set_job('text', repeat('Mitochondria make ATP. ', 5), null, 'Set ' || i);
  end loop;
  if (select count(*) from public.generation_jobs where status = 'queued' and title like 'Set _') <> 3 then raise exception 'jobs not queued'; end if;
  -- The same request again (a retry) gives back the job already made, even with three queued.
  if public.queue_study_set_job('text', repeat('Mitochondria make ATP. ', 5), null, 'Set 3') <> made then raise exception 'repeat request made a second job'; end if;
  if (select count(*) from public.generation_jobs where title = 'Set 3') <> 1 then raise exception 'repeat request duplicated the job'; end if;
  begin
    perform public.queue_study_set_job('text', repeat('Mitochondria make ATP. ', 5));
    raise exception 'fourth job queued';
  exception when program_limit_exceeded then null;
  end;
  begin
    perform input from public.generation_jobs;
    raise exception 'job input readable';
  exception when insufficient_privilege then null;
  end;

  -- Rate limits: 30 writes a minute.
  for i in 1..30 loop
    if not public.mcp_take_call('write') then raise exception 'write % refused', i; end if;
  end loop;
  if public.mcp_take_call('write') then raise exception '31st write allowed'; end if;
  if not public.mcp_take_call('read') then raise exception 'reads share the write budget'; end if;

  -- The audit log takes metadata and can't be read back.
  perform public.mcp_log_tool_call('record_answer', 'ok', null, 42);
  begin
    perform public.mcp_log_tool_call('record_answer', 'ok', 'Bad Code!', 42);
    raise exception 'free-text error code logged';
  exception when check_violation then null;
  end;
  begin
    perform count(*) from public.mcp_tool_calls;
    raise exception 'audit log readable';
  exception when insufficient_privilege then null;
  end;

  -- The backend logs the student's own answers, as mode mcp only.
  insert into public.learning_events (user_id, item_id, guide_id, mode, format, outcome, same_day, arm, params_version)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001:what makes atp', 'aaaaaaaa-0000-0000-0000-000000000001', 'mcp', 'flashcard', 'got_it', false, 'fsrs', 'none');
  begin
    insert into public.learning_events (user_id, item_id, guide_id, mode, format, outcome, same_day, arm, params_version)
    values ('11111111-1111-1111-1111-111111111111', 'x:y', 'aaaaaaaa-0000-0000-0000-000000000001', 'quiz', 'flashcard', 'got_it', false, 'fsrs', 'none');
    raise exception 'logged an answer as another mode';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.learning_events (user_id, item_id, guide_id, mode, format, outcome, same_day, arm, params_version)
    values ('33333333-3333-3333-3333-333333333333', 'x:y', 'aaaaaaaa-0000-0000-0000-000000000003', 'mcp', 'flashcard', 'got_it', false, 'fsrs', 'none');
    raise exception 'logged an answer for another student';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.study_guides set title = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'connected app updated a guide directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The other student sees none of it.
set role mcp_client;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set request.jwt.claims = '{"role":"mcp_client","sub":"33333333-3333-3333-3333-333333333333","client_id":"99999999-0000-0000-0000-000000000001"}';
do $$ begin
  if (select count(*) from public.generation_jobs) <> 0 then raise exception 'another student''s jobs visible'; end if;
  begin
    perform public.mcp_record_answer('answer-1', 'aaaaaaaa-0000-0000-0000-000000000001', '{"0":{"box":1,"due":"2026-11-04","known":true}}');
    raise exception 'answer saved on another student''s guide';
  exception when no_data_found then null;
  end;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.study_guides where title = 'Exam prep' and origin = 'mcp' and origin_client = 'Claude' and source_guide_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 1 then raise exception 'note not labelled'; end if;
  if (select count(*) from public.generation_jobs where source = 'mcp' and client_name = 'Claude' and input ->> 'kind' = 'text') <> 3 then raise exception 'job input not kept'; end if;
  if (select count(*) from public.mcp_tool_calls where tool_name = 'record_answer' and client_id = '99999999-0000-0000-0000-000000000001') <> 1 then raise exception 'audit row missing'; end if;
  perform public.mcp_cleanup_activity();
end $$;
select 'WRITE TOOLS OK';
