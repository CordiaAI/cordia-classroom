-- One memory for each student, shared by the Tutor and the Assistant (follow-up to feedback item 6).
-- NOT APPLIED: waiting for the owner's OK. Run after 20261121120000_adult_memory_tricks.sql.
--
-- public.student_memory: short, durable facts about a student that help them study (their goals,
-- interests, courses, how they like to learn), one row per fact, keyed on the Classroom account.
--   source 'tutor':     written by the backend from Tutor chats (backend/services/student_memory.py).
--   source 'assistant': mirrored from the Assistant's own assistant.memory_facts by the trigger below,
--                       through public.assistant_links, so the Assistant app needs no change.
-- Read by the backend (Help me remember's context, Settings › Tutor's "What Cordia remembers").
-- Students can read and delete their own rows; only the service role and the trigger write.
-- Forgetting an Assistant memory here also deletes it in the Assistant, and the other way round.
--
-- Assumes public.assistant_links.assistant_user_id holds assistant.users.id as text (the Assistant
-- repo writes it; no link existed to check against when this was written). Confirm before applying:
--   select count(*), count(u.id) from public.assistant_links l
--     left join assistant.users u on u.id::text = l.assistant_user_id;   -- the two counts match
--
-- Check afterwards:
--   select source, count(*) from public.student_memory group by 1;
--
-- Rollback:
--   drop trigger if exists assistant_memory_to_student_memory on assistant.memory_facts;
--   drop trigger if exists student_memory_forgets_assistant on public.student_memory;
--   drop function if exists public.mirror_assistant_memory();
--   drop function if exists public.forget_assistant_memory();
--   drop table if exists public.student_memory;

create table if not exists public.student_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('tutor', 'assistant')),
  category text not null default 'other' check (char_length(category) between 1 and 40),
  key text not null check (char_length(key) between 1 and 120),
  value text not null check (char_length(value) between 1 and 500),
  confidence numeric not null default 0.7 check (confidence >= 0 and confidence <= 1),
  source_ref text,                                   -- Tutor chat id, or the assistant.memory_facts id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, key)
);

create index if not exists student_memory_user_updated on public.student_memory (user_id, updated_at desc);

alter table public.student_memory enable row level security;
drop policy if exists "Students read their own memory" on public.student_memory;
create policy "Students read their own memory" on public.student_memory
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Students forget their own memory" on public.student_memory;
create policy "Students forget their own memory" on public.student_memory
  for delete to authenticated using (auth.uid() = user_id);

-- Assistant -> shared memory. Only for Assistant users linked to a Classroom account.
create or replace function public.mirror_assistant_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  classroom uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.student_memory where source = 'assistant' and source_ref = old.id::text;
    return old;
  end if;
  select l.user_id into classroom from public.assistant_links l where l.assistant_user_id = new.user_id::text;
  if classroom is null then
    return new;
  end if;
  insert into public.student_memory as m (user_id, source, category, key, value, confidence, source_ref, updated_at)
  values (classroom, 'assistant', left(coalesce(nullif(new.category, ''), 'other'), 40), left(new.key, 120),
          left(new.value, 500), least(greatest(coalesce(new.confidence, 0.7), 0), 1), new.id::text, now())
  on conflict (user_id, source, key) do update
    set category = excluded.category, value = excluded.value, confidence = excluded.confidence,
        source_ref = excluded.source_ref, updated_at = now();
  return new;
end
$$;
revoke execute on function public.mirror_assistant_memory() from public, anon, authenticated;

drop trigger if exists assistant_memory_to_student_memory on assistant.memory_facts;
create trigger assistant_memory_to_student_memory
  after insert or update or delete on assistant.memory_facts
  for each row execute function public.mirror_assistant_memory();

-- Shared memory -> Assistant: forgetting a mirrored fact in Classroom forgets it in the Assistant.
create or replace function public.forget_assistant_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source = 'assistant' and old.source_ref ~ '^[0-9a-f-]{36}$' then
    delete from assistant.memory_facts where id = old.source_ref::uuid;
  end if;
  return old;
end
$$;
revoke execute on function public.forget_assistant_memory() from public, anon, authenticated;

drop trigger if exists student_memory_forgets_assistant on public.student_memory;
create trigger student_memory_forgets_assistant
  after delete on public.student_memory
  for each row execute function public.forget_assistant_memory();

-- Backfill what the Assistant already remembers for linked students.
insert into public.student_memory (user_id, source, category, key, value, confidence, source_ref, updated_at)
select l.user_id, 'assistant', left(coalesce(nullif(f.category, ''), 'other'), 40), left(f.key, 120), left(f.value, 500),
       least(greatest(coalesce(f.confidence, 0.7), 0), 1), f.id::text, coalesce(f.updated_at, now())
from assistant.memory_facts f
join public.assistant_links l on l.assistant_user_id = f.user_id::text
on conflict (user_id, source, key) do nothing;
