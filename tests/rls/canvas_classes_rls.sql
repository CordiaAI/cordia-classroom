-- RLS rules for the Canvas + class sharing migration. Each block raises on failure.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@school.edu'),
  ('00000000-0000-0000-0000-00000000000b', 'member@school.edu'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@school.edu');
insert into public.schools (id, name, canvas_domain) values ('10000000-0000-0000-0000-000000000001', 'Test U', 'testu.instructure.com');
insert into public.classes (id, school_id, course_code_normalized, display_name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MGT 300', 'Management');
insert into public.class_terms (id, class_id, term) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Fall 2026'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Spring 2026');
-- Owner and member are in the class (different terms: membership is any term).
insert into public.class_memberships (user_id, class_term_id, source) values
  ('00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'canvas'),
  ('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000002', 'manual');
insert into public.study_guides (id, user_id, title) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Shared'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Private');
insert into public.shared_sets (id, guide_id, owner_id, class_id, visibility, title) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'class', 'Shared'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'private', 'Private');
insert into public.canvas_tokens (user_id, ciphertext, iv, last4) values
  ('00000000-0000-0000-0000-00000000000a', '\x00', '\x000000000000000000000000', 'abcd');
insert into public.canvas_activity (user_id, endpoint, status) values
  ('00000000-0000-0000-0000-00000000000a', 'courses.list', 200),
  ('00000000-0000-0000-0000-00000000000b', 'users.self', 200);

-- Rule 1: a member of the class reads the shared set; an outsider does not.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.shared_sets where id = '50000000-0000-0000-0000-000000000001') <> 1 then raise exception 'RULE1 member cannot read shared set'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if (select count(*) from public.shared_sets) <> 0 then raise exception 'RULE1 outsider can read shared sets'; end if;
end $$;

-- Rule 2: private sets are readable only by their owner (not even class members).
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.shared_sets where id = '50000000-0000-0000-0000-000000000002') <> 0 then raise exception 'RULE2 member reads a private set'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.shared_sets) <> 2 then raise exception 'RULE2 owner cannot read own sets'; end if;
end $$;

-- Hidden or held sets disappear for members.
reset role;
update public.shared_sets set status = 'held' where id = '50000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.shared_sets) <> 0 then raise exception 'held set visible to member'; end if;
end $$;
reset role;
update public.shared_sets set status = 'visible' where id = '50000000-0000-0000-0000-000000000001';

-- Rule 3: canvas_tokens is unreachable by clients, even for the token's owner.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  begin
    perform 1 from public.canvas_tokens;
    raise exception 'RULE3 authenticated read canvas_tokens';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.canvas_tokens;
    raise exception 'RULE3 anon read canvas_tokens';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'canvas_tokens') then raise exception 'RULE3 canvas_tokens has a policy'; end if;
end $$;
set role service_role;
do $$ begin
  if (select count(*) from public.canvas_tokens) <> 1 then raise exception 'RULE3 service role cannot read tokens'; end if;
end $$;
reset role;

-- Rule 4: activity rows are readable only by their user.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.canvas_activity) <> 1 or exists (select 1 from public.canvas_activity where user_id <> auth.uid()) then raise exception 'RULE4 activity leaks'; end if;
end $$;
-- Clients cannot write at all.
do $$ begin
  begin
    insert into public.canvas_activity (user_id, endpoint) values (auth.uid(), 'x');
    raise exception 'RULE4 client inserted activity';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Rosters stay private: a member sees only their own membership.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.class_memberships) <> 1 then raise exception 'roster visible'; end if;
end $$;
reset role;

-- Three reports hide a set.
insert into public.shared_set_reports (set_id, reporter_id, reason) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'wrong'),
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'wrong');
do $$ begin
  if (select status from public.shared_sets where id = '50000000-0000-0000-0000-000000000001') <> 'visible' then raise exception 'hidden after 2 reports'; end if;
end $$;
insert into public.shared_set_reports (set_id, reporter_id, reason) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'copied_exam');
do $$ begin
  if (select status from public.shared_sets where id = '50000000-0000-0000-0000-000000000001') <> 'hidden' then raise exception 'not hidden after 3 reports'; end if;
end $$;

-- An instructor block forces sets private.
update public.classes set sharing_blocked = true where id = '20000000-0000-0000-0000-000000000001';
update public.shared_sets set visibility = 'class' where id = '50000000-0000-0000-0000-000000000002';
do $$ begin
  if (select visibility from public.shared_sets where id = '50000000-0000-0000-0000-000000000002') <> 'private' then raise exception 'blocked class accepted a share'; end if;
end $$;

select 'RLS OK';
