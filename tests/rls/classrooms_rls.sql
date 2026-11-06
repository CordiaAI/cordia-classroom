-- Stage 5 classrooms on a local Postgres with the Supabase stub, tests/rls/mcp_read_access_seed.sql
-- and 20261015120000_canvas_classes.sql loaded. Run as a superuser; switches to `authenticated`.
-- Raises on the first failure.
insert into auth.users (id) values ('0000000a-0000-0000-0000-00000000000a'), ('0000000b-0000-0000-0000-00000000000b'),
  ('0000000c-0000-0000-0000-00000000000c') on conflict do nothing;
insert into public.classrooms (id, name, members_can_add, owner_id) values
  ('c1a55000-0000-0000-0000-000000000001', 'Biology study group', true, '0000000a-0000-0000-0000-00000000000a'),
  ('c1a55000-0000-0000-0000-000000000002', 'Archived group', true, '0000000a-0000-0000-0000-00000000000a');
update public.classrooms set archived_at = now() where id = 'c1a55000-0000-0000-0000-000000000002';
insert into public.classroom_members (classroom_id, user_id, role, status) values
  ('c1a55000-0000-0000-0000-000000000001', '0000000a-0000-0000-0000-00000000000a', 'owner', 'active'),
  ('c1a55000-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-00000000000b', 'member', 'active'),
  ('c1a55000-0000-0000-0000-000000000001', '0000000c-0000-0000-0000-00000000000c', 'member', 'pending'),
  ('c1a55000-0000-0000-0000-000000000002', '0000000b-0000-0000-0000-00000000000b', 'member', 'active');
insert into public.classroom_invites (classroom_id, token, short_code, created_by) values
  ('c1a55000-0000-0000-0000-000000000001', 'abcdefghijklmnopqrstuvwx', 'ABCD2345', '0000000a-0000-0000-0000-00000000000a');

do $$
begin
  -- A second owner is refused.
  begin
    insert into public.classroom_members (classroom_id, user_id, role) values ('c1a55000-0000-0000-0000-000000000001', '0000000c-0000-0000-0000-00000000000c', 'owner')
      on conflict (classroom_id, user_id) do update set role = 'owner';
    raise exception 'two owners allowed';
  exception when unique_violation then null;
  end;
  -- Codes can't use characters that are easy to misread.
  begin
    insert into public.classroom_invites (classroom_id, token, short_code) values ('c1a55000-0000-0000-0000-000000000001', 'zyxwvutsrqponmlkjihgfedcba', 'ABCD0OIL');
    raise exception 'ambiguous code allowed';
  exception when check_violation then null;
  end;
  if not public.is_classroom_member('c1a55000-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-00000000000b') then raise exception 'active member not a member'; end if;
  if public.is_classroom_member('c1a55000-0000-0000-0000-000000000001', '0000000c-0000-0000-0000-00000000000c') then raise exception 'pending member counted'; end if;
  if public.is_classroom_member('c1a55000-0000-0000-0000-000000000002', '0000000b-0000-0000-0000-00000000000b') then raise exception 'archived classroom counted'; end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = '0000000b-0000-0000-0000-00000000000b';
do $$
begin
  if (select count(*) from public.classrooms) <> 1 then raise exception 'member sees % classrooms', (select count(*) from public.classrooms); end if;
  if (select count(*) from public.classroom_members) <> 3 then raise exception 'member sees % member rows', (select count(*) from public.classroom_members); end if;
  begin
    perform 1 from public.classroom_invites;
    raise exception 'invites readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.classrooms (name, members_can_add, owner_id) values ('x', true, '0000000b-0000-0000-0000-00000000000b');
    raise exception 'browser insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.classroom_members set role = 'owner' where user_id = '0000000b-0000-0000-0000-00000000000b';
    raise exception 'browser update allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '0000000c-0000-0000-0000-00000000000c';
do $$
begin
  if (select count(*) from public.classrooms) <> 0 then raise exception 'pending member sees the classroom'; end if;
  if (select count(*) from public.classroom_items) <> 0 then raise exception 'pending member sees items'; end if;
end $$;
reset role;
select 'CLASSROOMS RLS OK';
