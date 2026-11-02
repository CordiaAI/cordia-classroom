-- MCP Phase 3: what the write tools need. Run after 20261101120000_mcp_read_access.sql. Safe to
-- run twice.
--
--   1. apply_study_progress(): updates one guide's flashcard schedule and Learn levels for just the
--      cards and ideas that were answered, under a row lock. The app (merge_study_progress) and
--      connected apps (mcp_record_answer) both save through it, so neither overwrites the other's
--      answers. The scheduling maths stays in the app's shared JavaScript (lib/spacedReview.mjs,
--      lib/learnEngine.mjs); this only merges the entries it computed.
--   2. mcp_record_answer(): one answer from a connected app, all at once: the schedule, Learn,
--      Retain misses, a practice result and the day's study log. An idempotency key makes a repeat
--      return the first result without counting twice (mcp_answer_receipts).
--   3. mcp_add_flashcards() and mcp_save_note(): add to the Library, never overwrite. Cards are
--      appended (exact duplicates skipped); a note is always a new page. Both are tagged
--      origin 'mcp' with the connected app's name, which the app shows as "Added from <name>".
--   4. queue_study_set_job(): a connected app asks for a study set; the backend's worker builds it
--      (generation_jobs gains the job's input, which is cleared once the job ends).
--   5. mcp_take_call(): per-student rate limits (120 reads, 30 writes a minute).
--   6. mcp_tool_calls: the audit log. Metadata only (tool, status, error code, time taken), never
--      arguments or results; admins only; kept 90 days.
-- Every function a connected app can run is SECURITY DEFINER with its own ownership checks, takes
-- the student from the token (auth.uid()) and never shows a guide built from a Canvas assignment.
-- Each grant to mcp_client is listed in supabase/checks/oauth_lockdown.sql.

-- 0. Where things came from ------------------------------------------------------------------------

alter table public.study_guides add column if not exists origin text;
alter table public.study_guides add column if not exists origin_client text;

-- The connected app's name, for "Added from <name>" (e.g. "Claude"). Null outside a connected-app call.
create or replace function public.mcp_client_label()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  name text;
begin
  if claims ->> 'role' is distinct from 'mcp_client' then
    return null;
  end if;
  begin
    select c.client_name into name from auth.oauth_clients c where c.id = (claims ->> 'client_id')::uuid;
  exception when others then
    return null;
  end;
  return left(nullif(btrim(coalesce(name, '')), ''), 60);
end
$$;
revoke execute on function public.mcp_client_label() from public, anon, authenticated;

-- True for a connected app's token (the access-token hook gives those the mcp_client role).
create or replace function public.mcp_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  uid uuid := auth.uid();
begin
  if uid is null or claims ->> 'role' is distinct from 'mcp_client' then
    raise exception 'Connect through Cordia''s consent page first' using errcode = '28000';
  end if;
  return uid;
end
$$;
revoke execute on function public.mcp_caller() from public, anon, authenticated;

-- 1. One guide's progress, merged entry by entry ---------------------------------------------------

-- cards: {"<card index>": {"box": 0-5, "due": "YYYY-MM-DD", "known": true|false}}
-- learn: {"levels": {"<idea index>": {"l": 0-3, "at": "YYYY-MM-DD"|null, "q": fingerprint, "sure"?: true}},
--         "test_date"?: "YYYY-MM-DD"|null}
-- Returns the guide's flashcard_progress after the merge. Owner and guide are checked by callers.
create or replace function public.apply_study_progress(owner uuid, guide uuid, cards jsonb default null, learn jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_found public.study_guides%rowtype;
  progress jsonb;
  schedule jsonb;
  known jsonb;
  unknown jsonb;
  levels jsonb;
  card_count integer;
  item record;
  idx integer;
begin
  select * into row_found from public.study_guides g where g.id = guide and g.user_id = owner for update;
  if not found then
    raise exception 'No study set with that id' using errcode = 'P0002';
  end if;
  progress := case when jsonb_typeof(row_found.flashcard_progress) = 'object' then row_found.flashcard_progress else '{}'::jsonb end;

  if cards is not null and cards <> '{}'::jsonb then
    if jsonb_typeof(cards) <> 'object' then
      raise exception 'cards must be an object' using errcode = '22023';
    end if;
    card_count := case when jsonb_typeof(row_found.flashcards) = 'array' then jsonb_array_length(row_found.flashcards) else 0 end;
    if (select count(*) from jsonb_object_keys(cards)) > 2000 then
      raise exception 'Too many cards' using errcode = '22023';
    end if;
    schedule := case when jsonb_typeof(progress -> 'schedule') = 'object' then progress -> 'schedule' else '{}'::jsonb end;
    known := case when jsonb_typeof(progress -> 'known') = 'array' then progress -> 'known' else '[]'::jsonb end;
    unknown := case when jsonb_typeof(progress -> 'unknown') = 'array' then progress -> 'unknown' else '[]'::jsonb end;
    for item in select key, value from jsonb_each(cards) loop
      if item.key !~ '^[0-9]{1,4}$' or jsonb_typeof(item.value) <> 'object'
        or jsonb_typeof(item.value -> 'box') <> 'number' or jsonb_typeof(item.value -> 'known') <> 'boolean'
        or coalesce(item.value ->> 'due', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Invalid card entry' using errcode = '22023';
      end if;
      idx := item.key::integer;
      if idx >= card_count or (item.value ->> 'box') !~ '^[0-5]$' then
        raise exception 'Invalid card entry' using errcode = '22023';
      end if;
      perform (item.value ->> 'due')::date;
      schedule := schedule || jsonb_build_object(item.key, jsonb_build_object('box', (item.value ->> 'box')::integer, 'due', item.value ->> 'due'));
      -- Same lists as lib/spacedReview.mjs applyResults: known cards out of unknown, missed ones out of known.
      if (item.value ->> 'known')::boolean then
        unknown := coalesce((select jsonb_agg(v) from jsonb_array_elements(unknown) v where v <> to_jsonb(idx)), '[]'::jsonb);
        if not known @> to_jsonb(idx) then known := known || to_jsonb(idx); end if;
      else
        known := coalesce((select jsonb_agg(v) from jsonb_array_elements(known) v where v <> to_jsonb(idx)), '[]'::jsonb);
        if not unknown @> to_jsonb(idx) then unknown := unknown || to_jsonb(idx); end if;
      end if;
    end loop;
    progress := progress || jsonb_build_object('schedule', schedule, 'known', known, 'unknown', unknown,
      'last_studied', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;

  if learn is not null and learn <> '{}'::jsonb then
    if jsonb_typeof(learn) <> 'object' then
      raise exception 'learn must be an object' using errcode = '22023';
    end if;
    levels := case when jsonb_typeof(progress -> 'learn' -> 'levels') = 'object' then progress -> 'learn' -> 'levels' else '{}'::jsonb end;
    if learn ? 'levels' then
      if jsonb_typeof(learn -> 'levels') <> 'object' or (select count(*) from jsonb_object_keys(learn -> 'levels')) > 2000 then
        raise exception 'Invalid Learn levels' using errcode = '22023';
      end if;
      for item in select key, value from jsonb_each(learn -> 'levels') loop
        if item.key !~ '^[0-9]{1,4}$' or jsonb_typeof(item.value) <> 'object'
          or coalesce(item.value ->> 'l', '') !~ '^[0-3]$' or jsonb_typeof(item.value -> 'q') <> 'string'
          or length(item.value ->> 'q') > 64
          or (item.value ? 'at' and jsonb_typeof(item.value -> 'at') <> 'null' and coalesce(item.value ->> 'at', '') !~ '^\d{4}-\d{2}-\d{2}$') then
          raise exception 'Invalid Learn level' using errcode = '22023';
        end if;
        levels := levels || jsonb_build_object(item.key, jsonb_strip_nulls(jsonb_build_object(
          'l', (item.value ->> 'l')::integer, 'q', item.value ->> 'q',
          'sure', case when item.value -> 'sure' = 'true'::jsonb then true end)) || jsonb_build_object('at', item.value -> 'at'));
      end loop;
    end if;
    progress := progress || jsonb_build_object('learn', jsonb_build_object(
      'levels', levels,
      'test_date', case
        when learn ? 'test_date' then
          case when jsonb_typeof(learn -> 'test_date') = 'string' and learn ->> 'test_date' ~ '^\d{4}-\d{2}-\d{2}$' then learn -> 'test_date' else 'null'::jsonb end
        else coalesce(progress -> 'learn' -> 'test_date', 'null'::jsonb)
      end));
  end if;

  update public.study_guides set flashcard_progress = progress where id = guide;
  return progress;
end
$$;
revoke execute on function public.apply_study_progress(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_study_progress(uuid, uuid, jsonb, jsonb) to service_role;

-- The app's save (Flashcards, Study now, Learn): the student's own guides only.
create or replace function public.merge_study_progress(guide uuid, cards jsonb default null, learn jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'mcp_client' then
    raise exception 'Connected apps record answers with mcp_record_answer' using errcode = '42501';
  end if;
  return public.apply_study_progress(auth.uid(), guide, cards, learn);
end
$$;
revoke execute on function public.merge_study_progress(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.merge_study_progress(uuid, jsonb, jsonb) to authenticated;

-- 2. One answer from a connected app ---------------------------------------------------------------

create table if not exists public.mcp_answer_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.mcp_answer_receipts enable row level security;
revoke all on table public.mcp_answer_receipts from public, anon, authenticated;

-- misses: the guide's Retain misses after this answer ([] removes them), from lib/retainMisses.mjs.
-- practice: {"index": n, "status": "correct"|"retry", "message": text} for a practice problem.
-- study_day: the day's study-log row after this answer (lib/studyDays.mjs), in the student's time zone.
-- result: what the tool returns; a repeat of the key returns the first one with "replayed": true.
create or replace function public.mcp_record_answer(answer_key text, guide uuid, cards jsonb default null, learn jsonb default null,
  misses jsonb default null, practice jsonb default null, study_day jsonb default null, result jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  prior jsonb;
  state jsonb;
  pidx integer;
  item jsonb;
begin
  if answer_key is null or length(answer_key) not between 1 and 200 then
    raise exception 'idempotency_key must be 1 to 200 characters' using errcode = '22023';
  end if;
  select r.result into prior from public.mcp_answer_receipts r where r.user_id = uid and r.idempotency_key = answer_key;
  if found then
    return prior || '{"replayed": true}'::jsonb;
  end if;
  perform 1 from public.study_guides g where g.id = guide and g.user_id = uid and coalesce(g.source_type, '') <> 'assignment' for update;
  if not found then
    raise exception 'No study set with that id' using errcode = 'P0002';
  end if;
  insert into public.mcp_answer_receipts (user_id, idempotency_key, result) values (uid, answer_key, coalesce(result, '{}'::jsonb))
  on conflict do nothing;
  if not found then
    select r.result into prior from public.mcp_answer_receipts r where r.user_id = uid and r.idempotency_key = answer_key;
    return coalesce(prior, '{}'::jsonb) || '{"replayed": true}'::jsonb;
  end if;

  perform public.apply_study_progress(uid, guide, cards, learn);

  if misses is not null then
    if jsonb_typeof(misses) <> 'array' or jsonb_array_length(misses) > 50 then
      raise exception 'Invalid Retain misses' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(misses) loop
      if jsonb_typeof(item -> 'question') <> 'string' or jsonb_typeof(item -> 'answer') <> 'string'
        or length(item ->> 'question') > 2000 or length(item ->> 'answer') > 4000 then
        raise exception 'Invalid Retain miss' using errcode = '22023';
      end if;
    end loop;
    if jsonb_array_length(misses) = 0 then
      delete from public.retain_misses where user_id = uid and guide_id = guide;
    else
      insert into public.retain_misses (user_id, guide_id, items, updated_at) values (uid, guide, misses, now())
      on conflict (user_id, guide_id) do update set items = excluded.items, updated_at = excluded.updated_at;
    end if;
  end if;

  if practice is not null then
    if jsonb_typeof(practice) <> 'object' or coalesce(practice ->> 'index', '') !~ '^[0-9]{1,3}$'
      or coalesce(practice ->> 'status', '') not in ('correct', 'retry') or length(coalesce(practice ->> 'message', '')) > 300 then
      raise exception 'Invalid practice result' using errcode = '22023';
    end if;
    select g.practice_state into state from public.study_guides g where g.id = guide;
    pidx := (practice ->> 'index')::integer;
    if jsonb_typeof(state -> 'problems') <> 'array' or pidx >= jsonb_array_length(state -> 'problems') then
      raise exception 'No practice problem with that id' using errcode = 'P0002';
    end if;
    state := jsonb_set(state, '{progress}', coalesce(case when jsonb_typeof(state -> 'progress') = 'object' then state -> 'progress' end, '{}'::jsonb));
    state := jsonb_set(state, '{progress,evaluations}', coalesce(case when jsonb_typeof(state -> 'progress' -> 'evaluations') = 'object' then state -> 'progress' -> 'evaluations' end, '{}'::jsonb)
      || jsonb_build_object(pidx::text, jsonb_build_object('status', practice ->> 'status', 'message', coalesce(practice ->> 'message', ''))));
    state := jsonb_set(state, '{progress,revealed}', coalesce(case when jsonb_typeof(state -> 'progress' -> 'revealed') = 'object' then state -> 'progress' -> 'revealed' end, '{}'::jsonb)
      || jsonb_build_object(pidx::text, true));
    update public.study_guides set practice_state = state where id = guide;
  end if;

  if study_day is not null then
    if jsonb_typeof(study_day) <> 'object' or coalesce(study_day ->> 'day', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(study_day -> 'guides') <> 'object' or length((study_day -> 'guides')::text) > 20000 then
      raise exception 'Invalid study day' using errcode = '22023';
    end if;
    insert into public.study_days (user_id, day, minutes, cards, right_count, total, guides, updated_at)
    values (uid, (study_day ->> 'day')::date,
      least(1440, greatest(0, coalesce((study_day ->> 'minutes')::real, 0))),
      greatest(0, coalesce((study_day ->> 'cards')::integer, 0)),
      greatest(0, coalesce((study_day ->> 'right_count')::integer, 0)),
      greatest(0, coalesce((study_day ->> 'total')::integer, 0)),
      study_day -> 'guides', now())
    on conflict (user_id, day) do update set minutes = excluded.minutes, cards = excluded.cards, right_count = excluded.right_count,
      total = excluded.total, guides = excluded.guides, updated_at = excluded.updated_at;
  end if;

  return coalesce(result, '{}'::jsonb) || '{"replayed": false}'::jsonb;
end
$$;
revoke execute on function public.mcp_record_answer(text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_record_answer(text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to mcp_client;

-- The backend logs a connected app's answers (services/learning_events.write_batch) as the student.
grant insert (user_id, item_id, guide_id, decision_id, mode, format, outcome, confidence, first_key_ms, submit_ms, hidden_ms, rapid_guess,
  answer_chars, view_shown, fsrs_rating, same_day, arm, params_version, occurred_at) on public.learning_events to mcp_client;
grant usage on sequence public.learning_events_id_seq to mcp_client;
drop policy if exists "Connected apps log the student's answers" on public.learning_events;
create policy "Connected apps log the student's answers" on public.learning_events
  for insert to mcp_client with check (auth.uid() = user_id and mode = 'mcp' and decision_id is null);

-- 3. Adding to the Library ---------------------------------------------------------------------------

-- cards: [{"front": text (≤500), "back": text (≤2000)}], 1 to 50. Appended in order; a card whose
-- front and back match one already in the set (or earlier in the list) is skipped.
create or replace function public.mcp_add_flashcards(guide uuid, cards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  existing jsonb;
  seen text[];
  added jsonb := '[]'::jsonb;
  indexes integer[] := '{}';
  skipped integer := 0;
  item jsonb;
  front text;
  back text;
  mark text;
  label text := public.mcp_client_label();
begin
  if jsonb_typeof(cards) <> 'array' or jsonb_array_length(cards) not between 1 and 50 then
    raise exception 'Send 1 to 50 cards' using errcode = '22023';
  end if;
  select g.flashcards into existing from public.study_guides g
  where g.id = guide and g.user_id = uid and coalesce(g.source_type, '') <> 'assignment' for update;
  if not found then
    raise exception 'No study set with that id' using errcode = 'P0002';
  end if;
  existing := case when jsonb_typeof(existing) = 'array' then existing else '[]'::jsonb end;
  select coalesce(array_agg(lower(btrim(coalesce(c ->> 'front', ''))) || chr(31) || lower(btrim(coalesce(c ->> 'back', '')))), '{}')
    into seen from jsonb_array_elements(existing) c;
  for item in select value from jsonb_array_elements(cards) loop
    front := btrim(coalesce(item ->> 'front', ''));
    back := btrim(coalesce(item ->> 'back', ''));
    if jsonb_typeof(item) <> 'object' or front = '' or back = '' or length(front) > 500 or length(back) > 2000 then
      raise exception 'Each card needs a front (up to 500 characters) and a back (up to 2,000)' using errcode = '22023';
    end if;
    mark := lower(front) || chr(31) || lower(back);
    if mark = any(seen) then
      skipped := skipped + 1;
      continue;
    end if;
    seen := seen || mark;
    indexes := indexes || (jsonb_array_length(existing) + jsonb_array_length(added));
    added := added || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('front', front, 'back', back, 'source', 'mcp', 'added_by', label)));
  end loop;
  if jsonb_array_length(existing) + jsonb_array_length(added) > 2000 then
    raise exception 'A study set holds at most 2,000 flashcards' using errcode = '22023';
  end if;
  if jsonb_array_length(added) > 0 then
    update public.study_guides set flashcards = existing || added where id = guide;
  end if;
  return jsonb_build_object('added_count', jsonb_array_length(added), 'skipped_duplicates', skipped, 'card_indexes', to_jsonb(indexes));
end
$$;
revoke execute on function public.mcp_add_flashcards(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_add_flashcards(uuid, jsonb) to mcp_client;

-- A note is a new page in the Library, like New › Note: a guide whose notes are the outline text
-- (lib/outlineDoc.js), in a course and next to a study set when given. Returns the new page's id.
create or replace function public.mcp_save_note(title text, notes text, course uuid default null, study_set uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  made uuid;
begin
  if btrim(coalesce(title, '')) = '' or length(title) > 200 then
    raise exception 'The title must be 1 to 200 characters' using errcode = '22023';
  end if;
  if btrim(coalesce(notes, '')) = '' or length(notes) > 60000 then
    raise exception 'The note is empty or too long' using errcode = '22023';
  end if;
  if course is not null and not exists (select 1 from public.folders f where f.id = course and f.user_id = uid) then
    raise exception 'No course with that id' using errcode = 'P0002';
  end if;
  if study_set is not null and not exists (
    select 1 from public.study_guides g where g.id = study_set and g.user_id = uid and coalesce(g.source_type, '') <> 'assignment') then
    raise exception 'No study set with that id' using errcode = 'P0002';
  end if;
  if (select count(*) from public.study_guides g where g.user_id = uid and g.origin = 'mcp' and g.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many new pages this hour' using errcode = '54000';
  end if;
  insert into public.study_guides (user_id, title, notes, source_type, folder_id, source_guide_id, origin, origin_client)
  values (uid, btrim(title), notes, 'notes', course, study_set, 'mcp', public.mcp_client_label())
  returning id into made;
  return made;
end
$$;
revoke execute on function public.mcp_save_note(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_save_note(text, text, uuid, uuid) to mcp_client;

-- 4. Study-set jobs ----------------------------------------------------------------------------------

alter table public.generation_jobs add column if not exists title text;
alter table public.generation_jobs add column if not exists folder_id uuid references public.folders(id) on delete set null;
alter table public.generation_jobs add column if not exists input jsonb;
alter table public.generation_jobs add column if not exists client_name text;
alter table public.generation_jobs add column if not exists attempts integer not null default 0;
alter table public.generation_jobs add column if not exists started_at timestamptz;
alter table public.generation_jobs add column if not exists finished_at timestamptz;
alter table public.generation_jobs add column if not exists seen_at timestamptz;
create index if not exists generation_jobs_queue_idx on public.generation_jobs (created_at) where status in ('queued', 'running');

-- A connected app's request. source_kind 'text' (source_text, up to 200,000 characters) or 'url'
-- (source_url, checked again by the backend before anything is fetched). At most 3 waiting or running
-- and 10 an hour per student; the backend checks the plan's monthly study sets before it's built.
create or replace function public.queue_study_set_job(source_kind text, source_text text default null, source_url text default null,
  title text default null, course uuid default null, outputs text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  made uuid;
begin
  if source_kind = 'text' then
    if length(btrim(coalesce(source_text, ''))) < 40 or length(source_text) > 200000 then
      raise exception 'Send 40 to 200,000 characters of text' using errcode = '22023';
    end if;
  elsif source_kind = 'url' then
    if coalesce(source_url, '') !~* '^https?://[^\s]+$' or length(source_url) > 2048 then
      raise exception 'Send an http or https link' using errcode = '22023';
    end if;
  else
    raise exception 'source must be text or url' using errcode = '22023';
  end if;
  if title is not null and length(title) > 200 then
    raise exception 'The title is too long' using errcode = '22023';
  end if;
  if outputs is not null and not (outputs <@ array['notes', 'study_guide', 'flashcards']) then
    raise exception 'Unknown output' using errcode = '22023';
  end if;
  if course is not null and not exists (select 1 from public.folders f where f.id = course and f.user_id = uid) then
    raise exception 'No course with that id' using errcode = 'P0002';
  end if;
  if (select count(*) from public.generation_jobs j where j.user_id = uid and j.status in ('queued', 'running')) >= 3 then
    raise exception 'Three study sets are already being made. Wait for one to finish.' using errcode = '54000';
  end if;
  if (select count(*) from public.generation_jobs j where j.user_id = uid and j.source = 'mcp' and j.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Ten study sets were requested in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into public.generation_jobs (user_id, kind, status, source, title, folder_id, client_name, input)
  values (uid, 'study_set', 'queued', 'mcp', nullif(btrim(coalesce(title, '')), ''), course, public.mcp_client_label(),
    jsonb_strip_nulls(jsonb_build_object('kind', source_kind, 'text', source_text, 'url', source_url, 'outputs', to_jsonb(outputs))))
  returning id into made;
  return made;
end
$$;
revoke execute on function public.queue_study_set_job(text, text, text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.queue_study_set_job(text, text, text, text, uuid, text[]) to mcp_client;

grant select (title) on public.generation_jobs to mcp_client;

-- 5. Rate limits -------------------------------------------------------------------------------------

create table if not exists public.mcp_rate_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('read', 'write')),
  window_start timestamptz not null,
  calls integer not null default 0,
  primary key (user_id, bucket, window_start)
);
alter table public.mcp_rate_counters enable row level security;
revoke all on table public.mcp_rate_counters from public, anon, authenticated;

-- Counts one tool call in this minute's window; false once the student is over the limit.
create or replace function public.mcp_take_call(kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  used integer;
begin
  if kind not in ('read', 'write') then
    raise exception 'kind must be read or write' using errcode = '22023';
  end if;
  insert into public.mcp_rate_counters as c (user_id, bucket, window_start, calls)
  values (uid, kind, date_trunc('minute', now()), 1)
  on conflict (user_id, bucket, window_start) do update set calls = c.calls + 1
  returning calls into used;
  return used <= case kind when 'read' then 120 else 30 end;
end
$$;
revoke execute on function public.mcp_take_call(text) from public, anon, authenticated;
grant execute on function public.mcp_take_call(text) to mcp_client;

-- 6. Audit log: metadata only ---------------------------------------------------------------------------

create table if not exists public.mcp_tool_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid,
  tool_name text not null check (tool_name ~ '^[a-z_]{1,64}$'),
  status text not null check (status in ('ok', 'error', 'rate_limited')),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,64}$'),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists mcp_tool_calls_created_idx on public.mcp_tool_calls (created_at);
alter table public.mcp_tool_calls enable row level security;
revoke all on table public.mcp_tool_calls from public, anon, authenticated;
do $$ begin
  if to_regclass('public.app_admins') is not null then
    grant select on table public.mcp_tool_calls to authenticated;
    drop policy if exists "Admins read connected-app calls" on public.mcp_tool_calls;
    create policy "Admins read connected-app calls" on public.mcp_tool_calls
      for select to authenticated using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));
  end if;
end $$;

create or replace function public.mcp_log_tool_call(tool text, status text, error_code text default null, latency_ms integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_caller();
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  cid uuid;
begin
  begin
    cid := (claims ->> 'client_id')::uuid;
  exception when others then
    cid := null;
  end;
  insert into public.mcp_tool_calls (user_id, client_id, tool_name, status, error_code, latency_ms)
  values (uid, cid, tool, status, error_code, least(greatest(latency_ms, 0), 3600000));
end
$$;
revoke execute on function public.mcp_log_tool_call(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.mcp_log_tool_call(text, text, text, integer) to mcp_client;

-- Daily cleanup: audit log after 90 days, answer receipts after 30, rate windows after a day, a
-- finished job's input after a day and the job itself after 30.
create or replace function public.mcp_cleanup_activity()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.mcp_tool_calls where created_at < now() - interval '90 days';
  delete from public.mcp_answer_receipts where created_at < now() - interval '30 days';
  delete from public.mcp_rate_counters where window_start < now() - interval '1 day';
  update public.generation_jobs set input = null
  where input is not null and status in ('done', 'failed') and updated_at < now() - interval '1 day';
  delete from public.generation_jobs where created_at < now() - interval '30 days';
end
$$;
revoke execute on function public.mcp_cleanup_activity() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('mcp-activity-cleanup', '41 3 * * *', 'select public.mcp_cleanup_activity()');
  end if;
end $$;

notify pgrst, 'reload schema';
