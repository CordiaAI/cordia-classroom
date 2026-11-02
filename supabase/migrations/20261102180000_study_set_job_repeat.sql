-- create_study_set sent twice (a connected app retrying after a timeout, or the student asking
-- twice) gives back the first job instead of making a second study set. Same student, same source,
-- title, course and outputs, within 10 minutes, and that job hasn't failed.

alter table public.generation_jobs add column if not exists source_hash text;
create index if not exists generation_jobs_repeat_idx on public.generation_jobs (user_id, source_hash, created_at desc)
  where source_hash is not null;

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
  request_hash text;
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

  -- The same request again: the job already made for it.
  request_hash := md5(concat_ws(chr(31), source_kind, btrim(coalesce(source_text, source_url)), btrim(coalesce(title, '')),
    coalesce(course::text, ''), coalesce(array_to_string(outputs, ','), '')));
  select j.id into made from public.generation_jobs j
  where j.user_id = uid and j.source = 'mcp' and j.source_hash = request_hash and j.status <> 'failed'
    and j.created_at > now() - interval '10 minutes'
  order by j.created_at desc limit 1;
  if made is not null then
    return made;
  end if;

  if (select count(*) from public.generation_jobs j where j.user_id = uid and j.status in ('queued', 'running')) >= 3 then
    raise exception 'Three study sets are already being made. Wait for one to finish.' using errcode = '54000';
  end if;
  if (select count(*) from public.generation_jobs j where j.user_id = uid and j.source = 'mcp' and j.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Ten study sets were requested in the last hour. Try again later.' using errcode = '54000';
  end if;
  insert into public.generation_jobs (user_id, kind, status, source, title, folder_id, client_name, input, source_hash)
  values (uid, 'study_set', 'queued', 'mcp', nullif(btrim(coalesce(title, '')), ''), course, public.mcp_client_label(),
    jsonb_strip_nulls(jsonb_build_object('kind', source_kind, 'text', source_text, 'url', source_url, 'outputs', to_jsonb(outputs))),
    request_hash)
  returning id into made;
  return made;
end
$$;
revoke execute on function public.queue_study_set_job(text, text, text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.queue_study_set_job(text, text, text, text, uuid, text[]) to mcp_client;
