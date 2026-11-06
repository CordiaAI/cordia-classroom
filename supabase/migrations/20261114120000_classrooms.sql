-- NOT APPLIED: waiting for owner's OK. Social plan, Stage 5: classrooms (roles, invites, joining, items).
--
-- A classroom is a group a student is invited into, with roles. It's separate from a course
-- (classes + class_terms, which anyone can claim to take by typing its code; see
-- docs/design/social-sharing-audit.md §10). A classroom can optionally point at a course and term.
--   classrooms           the group: study group or instructor class, who may add and invite
--   classroom_members    who's in it, their role, and whether staff may see their progress
--   classroom_items      guides and folders shared with it (a folder is live: guides added to it later
--                        show up too), with an optional milestone
--   classroom_invites    links and 8-character codes, with expiry, use limits and revocation; an
--                        invite can also be addressed to one person (inviting a friend)
--   classroom_activity   member joined, guide or folder added, milestone set
-- An instructor class needs an admin's approval: until then it works as a study group
-- (instructor_request = 'requested'). Members can read their own classrooms (RLS, through
-- is_classroom_member); every write goes through the backend with the service role, which re-checks
-- roles, blocks and caps itself. The app works the same until this is applied and CLASSROOMS=true.
--
-- Check afterwards:
--   select to_regclass('public.classrooms'), to_regclass('public.classroom_members'), to_regclass('public.classroom_items'),
--          to_regclass('public.classroom_invites'), to_regclass('public.classroom_activity');                       -- all set
--   select has_table_privilege('authenticated', 'public.classroom_invites', 'SELECT');                             -- false
--   select has_table_privilege('authenticated', 'public.classrooms', 'INSERT');                                   -- false
--
-- Rollback:
-- drop function if exists public.is_classroom_member(uuid, uuid);
-- drop table if exists public.classroom_activity;
-- drop table if exists public.classroom_invites;
-- drop table if exists public.classroom_items;
-- drop table if exists public.classroom_members;
-- drop table if exists public.classrooms;

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'study_group' check (kind in ('study_group', 'instructor_class')),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  school_id uuid references public.schools on delete set null,
  class_id uuid references public.classes on delete set null,
  class_term_id uuid references public.class_terms on delete set null,
  visibility text not null default 'unlisted' check (visibility in ('public', 'unlisted', 'private')),
  join_policy text not null default 'auto' check (join_policy in ('auto', 'approval')),
  members_can_add boolean not null,
  members_can_invite boolean not null default true,
  -- An instructor class waits for an admin: requested -> approved (kind becomes instructor_class) or declined.
  instructor_request text check (instructor_request in ('requested', 'approved', 'declined')),
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists classrooms_owner_idx on public.classrooms (owner_id);
create index if not exists classrooms_class_idx on public.classrooms (class_id) where class_id is not null and archived_at is null;
create index if not exists classrooms_request_idx on public.classrooms (instructor_request) where instructor_request = 'requested';

create table if not exists public.classroom_members (
  classroom_id uuid not null references public.classrooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner', 'instructor', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'removed')),
  progress_visible_to_staff boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (classroom_id, user_id)
);
create index if not exists classroom_members_user_idx on public.classroom_members (user_id, status);
-- One owner per classroom.
create unique index if not exists classroom_members_one_owner on public.classroom_members (classroom_id) where role = 'owner';

create table if not exists public.classroom_items (
  classroom_id uuid not null references public.classrooms on delete cascade,
  item_type text not null check (item_type in ('guide', 'folder')),
  item_id uuid not null,
  added_by uuid references auth.users on delete set null,
  position integer not null default 0,
  milestone_label text check (milestone_label is null or length(milestone_label) <= 120),
  milestone_date date,
  added_at timestamptz not null default now(),
  primary key (classroom_id, item_type, item_id)
);
create index if not exists classroom_items_item_idx on public.classroom_items (item_type, item_id);

create table if not exists public.classroom_invites (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  -- 8 characters with nothing easy to misread (no 0/O, 1/I/L).
  short_code text not null unique check (short_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  invitee_id uuid references auth.users on delete cascade,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists classroom_invites_classroom_idx on public.classroom_invites (classroom_id);

create table if not exists public.classroom_activity (
  id bigserial primary key,
  classroom_id uuid not null references public.classrooms on delete cascade,
  actor_id uuid references auth.users on delete set null,
  kind text not null check (kind in ('member_joined', 'guide_added', 'folder_added', 'milestone_set')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 4096),
  created_at timestamptz not null default now()
);
create index if not exists classroom_activity_classroom_idx on public.classroom_activity (classroom_id, created_at desc);

create or replace function public.is_classroom_member(c uuid, u uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.classroom_members m join public.classrooms r on r.id = m.classroom_id
    where m.classroom_id = c and m.user_id = u and m.status = 'active' and r.archived_at is null
  )
$$;
revoke execute on function public.is_classroom_member(uuid, uuid) from public, anon;
grant execute on function public.is_classroom_member(uuid, uuid) to authenticated, service_role;

alter table public.classrooms enable row level security;
alter table public.classroom_members enable row level security;
alter table public.classroom_items enable row level security;
alter table public.classroom_invites enable row level security;
alter table public.classroom_activity enable row level security;
revoke all on table public.classrooms, public.classroom_members, public.classroom_items, public.classroom_invites, public.classroom_activity
  from public, anon, authenticated;
grant select on table public.classrooms, public.classroom_members, public.classroom_items, public.classroom_activity to authenticated;
grant select, insert, update, delete on table public.classrooms, public.classroom_members, public.classroom_items,
  public.classroom_invites, public.classroom_activity to service_role;
grant usage, select on sequence public.classroom_activity_id_seq to service_role;

-- Members read their own classrooms; nothing is writable from the browser (no write policies).
drop policy if exists classrooms_members_read on public.classrooms;
create policy classrooms_members_read on public.classrooms for select to authenticated
  using (public.is_classroom_member(id, auth.uid()));
drop policy if exists classroom_members_members_read on public.classroom_members;
create policy classroom_members_members_read on public.classroom_members for select to authenticated
  using (public.is_classroom_member(classroom_id, auth.uid()));
drop policy if exists classroom_items_members_read on public.classroom_items;
create policy classroom_items_members_read on public.classroom_items for select to authenticated
  using (public.is_classroom_member(classroom_id, auth.uid()));
drop policy if exists classroom_activity_members_read on public.classroom_activity;
create policy classroom_activity_members_read on public.classroom_activity for select to authenticated
  using (public.is_classroom_member(classroom_id, auth.uid()));
