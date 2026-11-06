-- NOT APPLIED: waiting for owner's OK. Learn format ladder (LEARN_LADDER_V2), Change 3.
--
-- Learn saves "What's the test like?" next to the test date, as flashcard_progress.learn.test_format
-- ('mc' | 'short' | 'essay' | 'mix' | 'unsure'). apply_study_progress (the merge behind
-- merge_study_progress and mcp_record_answer) rebuilds `learn` from levels and test_date, so today it
-- drops test_format on every progress save. This redefines it to accept test_format and keep the saved
-- one otherwise. Nothing else in the function changes (copied from 20261102120000_mcp_write_tools.sql).
--
-- Until this runs, Learn re-saves the format through PATCH /guides/{id}/test-format whenever a merge
-- drops it, so the feature works without it (just with an extra request).
--
-- Rollback: re-run the apply_study_progress definition from 20261102120000_mcp_write_tools.sql.

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
  fmt jsonb;
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
    -- What the test is like (Learn, LEARN_LADDER_V2): taken when sent and valid, otherwise the saved one is kept.
    fmt := case
      when learn ? 'test_format' and learn ->> 'test_format' in ('mc', 'short', 'essay', 'mix', 'unsure') then learn -> 'test_format'
      when jsonb_typeof(progress -> 'learn' -> 'test_format') = 'string' then progress -> 'learn' -> 'test_format'
    end;
    progress := progress || jsonb_build_object('learn', jsonb_build_object(
      'levels', levels,
      'test_date', case
        when learn ? 'test_date' then
          case when jsonb_typeof(learn -> 'test_date') = 'string' and learn ->> 'test_date' ~ '^\d{4}-\d{2}-\d{2}$' then learn -> 'test_date' else 'null'::jsonb end
        else coalesce(progress -> 'learn' -> 'test_date', 'null'::jsonb)
      end) || case when fmt is null then '{}'::jsonb else jsonb_build_object('test_format', fmt) end);
  end if;

  update public.study_guides set flashcard_progress = progress where id = guide;
  return progress;
end
$$;
revoke execute on function public.apply_study_progress(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_study_progress(uuid, uuid, jsonb, jsonb) to service_role;
