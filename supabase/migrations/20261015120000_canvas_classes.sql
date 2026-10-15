-- Canvas connection, shared class database and class sharing.
--
-- Security model
--   * Every write goes through FastAPI with the service role after it verifies the caller.
--   * The browser may read only what the policies below allow.
--   * canvas_tokens has RLS enabled and NO policies, and no grants to anon/authenticated:
--     only the service role can touch it. Tokens are AES-256-GCM ciphertext; the key lives
--     in the CANVAS_TOKEN_KEY environment variable, never in the database.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on table public.app_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.app_admins to service_role;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_admins where user_id = auth.uid()) $$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- School policy: which Canvas hosts may be used, and whether student tokens are allowed
-- ---------------------------------------------------------------------------
create table if not exists public.canvas_school_policy (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+$'),
  school_name text not null default '',
  tokens_allowed boolean not null default true,
  source_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.canvas_school_policy enable row level security;
revoke all on table public.canvas_school_policy from public, anon, authenticated;
grant select on table public.canvas_school_policy to anon, authenticated;
grant select, insert, update, delete on table public.canvas_school_policy to service_role;
drop policy if exists "Anyone reads school policy" on public.canvas_school_policy;
create policy "Anyone reads school policy" on public.canvas_school_policy for select using (true);

-- University of Missouri System campuses do not allow students to create Canvas access tokens.
insert into public.canvas_school_policy (domain, school_name, tokens_allowed, source_url) values
  ('umsystem.instructure.com', 'University of Missouri System', false, null),
  ('canvas.missouri.edu', 'University of Missouri', false, null),
  ('canvas.umkc.edu', 'University of Missouri-Kansas City', false, null),
  ('canvas.umsl.edu', 'University of Missouri-St. Louis', false, null),
  ('canvas.mst.edu', 'Missouri University of Science and Technology', false, null)
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- Class database
-- ---------------------------------------------------------------------------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  canvas_domain text unique check (canvas_domain is null or canvas_domain = lower(canvas_domain)),
  email_domains text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  course_code_normalized text not null check (course_code_normalized ~ '^[A-Z&]{1,8} [0-9]{1,4}[A-Z]?$'),
  display_name text not null default '',
  sharing_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, course_code_normalized)
);

create table if not exists public.class_terms (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  term text not null check (char_length(term) between 1 and 60),
  unique (class_id, term)
);

create table if not exists public.class_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  class_term_id uuid not null references public.class_terms(id) on delete cascade,
  source text not null check (source in ('canvas', 'calendar', 'manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, class_term_id)
);
create index if not exists class_memberships_term_idx on public.class_memberships (class_term_id);

-- Ambiguous normalizations wait here for an admin; nothing merges silently.
create table if not exists public.class_merge_proposals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  raw_code text not null,
  from_class_id uuid references public.classes(id) on delete cascade,
  into_class_id uuid references public.classes(id) on delete cascade,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

create or replace function public.is_class_member(target_class uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.class_memberships m
    join public.class_terms t on t.id = m.class_term_id
    where t.class_id = target_class and m.user_id = auth.uid()
  )
$$;
revoke execute on function public.is_class_member(uuid) from public, anon;
grant execute on function public.is_class_member(uuid) to authenticated, service_role;

alter table public.schools enable row level security;
alter table public.classes enable row level security;
alter table public.class_terms enable row level security;
alter table public.class_memberships enable row level security;
alter table public.class_merge_proposals enable row level security;
revoke all on table public.schools, public.classes, public.class_terms, public.class_memberships, public.class_merge_proposals from public, anon, authenticated;
grant select on table public.schools, public.classes, public.class_terms to authenticated;
grant select on table public.class_memberships to authenticated;
grant select, insert, update, delete on table public.schools, public.classes, public.class_terms, public.class_memberships, public.class_merge_proposals to service_role;

drop policy if exists "Signed-in users read schools" on public.schools;
create policy "Signed-in users read schools" on public.schools for select to authenticated using (true);
drop policy if exists "Signed-in users read classes" on public.classes;
create policy "Signed-in users read classes" on public.classes for select to authenticated using (true);
drop policy if exists "Signed-in users read class terms" on public.class_terms;
create policy "Signed-in users read class terms" on public.class_terms for select to authenticated using (true);
-- Memberships are private: you see your own, never a roster.
drop policy if exists "Users read own memberships" on public.class_memberships;
create policy "Users read own memberships" on public.class_memberships for select to authenticated using (user_id = auth.uid());

-- Library folders can stand for a class.
alter table public.folders add column if not exists class_id uuid references public.classes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Canvas connection (token stored encrypted; server role only)
-- ---------------------------------------------------------------------------
create table if not exists public.canvas_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null check (octet_length(iv) = 12),
  last4 text not null check (char_length(last4) = 4),
  expires_at date,
  created_at timestamptz not null default now()
);
alter table public.canvas_tokens enable row level security;
revoke all on table public.canvas_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.canvas_tokens to service_role;
-- Deliberately no policies on canvas_tokens.

create table if not exists public.canvas_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  canvas_domain text not null,
  school_id uuid references public.schools(id) on delete set null,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  sync_paused boolean not null default false,
  last_synced_at timestamptz,
  expiry_reminded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only what the feature needs: no rosters, grades, submissions or messages.
create table if not exists public.canvas_courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_course_id bigint not null,
  name text not null default '',
  course_code text not null default '',
  term text not null default '',
  school_id uuid references public.schools(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  imported boolean not null default false,
  topic_summary text not null default '' check (char_length(topic_summary) <= 600),
  primary key (user_id, canvas_course_id)
);

create table if not exists public.canvas_assignments (
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_assignment_id bigint not null,
  canvas_course_id bigint not null,
  title text not null default '',
  due_at timestamptz,
  primary key (user_id, canvas_assignment_id)
);

create table if not exists public.canvas_activity (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 60),
  status integer,
  created_at timestamptz not null default now()
);
create index if not exists canvas_activity_user_time_idx on public.canvas_activity (user_id, created_at desc);

alter table public.canvas_connections enable row level security;
alter table public.canvas_courses enable row level security;
alter table public.canvas_assignments enable row level security;
alter table public.canvas_activity enable row level security;
revoke all on table public.canvas_connections, public.canvas_courses, public.canvas_assignments, public.canvas_activity from public, anon, authenticated;
grant select on table public.canvas_connections, public.canvas_courses, public.canvas_assignments, public.canvas_activity to authenticated;
grant select, insert, update, delete on table public.canvas_connections, public.canvas_courses, public.canvas_assignments, public.canvas_activity to service_role;
grant usage on sequence public.canvas_activity_id_seq to service_role;

drop policy if exists "Users read own canvas connection" on public.canvas_connections;
create policy "Users read own canvas connection" on public.canvas_connections for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users read own canvas courses" on public.canvas_courses;
create policy "Users read own canvas courses" on public.canvas_courses for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users read own canvas assignments" on public.canvas_assignments;
create policy "Users read own canvas assignments" on public.canvas_assignments for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users read own canvas activity" on public.canvas_activity;
create policy "Users read own canvas activity" on public.canvas_activity for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------
create table if not exists public.sharing_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_first_name boolean not null default false
);

create table if not exists public.class_share_defaults (
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  share boolean not null,
  primary key (user_id, class_id)
);

-- A shared set is a snapshot of the guide text and cards only: never notes, chats,
-- progress or source files.
create table if not exists public.shared_sets (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null unique references public.study_guides(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'class')),
  status text not null default 'visible' check (status in ('visible', 'held', 'hidden', 'taken_down')),
  hold_reason text,
  title text not null default '',
  study_guide text not null default '',
  flashcards jsonb not null default '[]'::jsonb,
  card_count integer not null default 0,
  owner_name text,
  cluster_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_sets_class_idx on public.shared_sets (class_id, status, visibility);

create table if not exists public.shared_set_studiers (
  set_id uuid not null references public.shared_sets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  accuracy numeric check (accuracy between 0 and 100),
  last_studied_at timestamptz not null default now(),
  primary key (set_id, user_id)
);

create table if not exists public.shared_set_reports (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.shared_sets(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('wrong', 'copied_exam', 'copyright', 'inappropriate')),
  status text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  created_at timestamptz not null default now(),
  unique (set_id, reporter_id)
);

create table if not exists public.instructor_blocks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (class_id, email)
);

create table if not exists public.copyright_takedowns (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references public.shared_sets(id) on delete set null,
  claimant_name text not null check (char_length(claimant_name) between 1 and 200),
  claimant_email text not null check (char_length(claimant_email) between 3 and 320),
  work_description text not null check (char_length(work_description) between 1 and 4000),
  location text not null default '' check (char_length(location) <= 2000),
  status text not null default 'received' check (status in ('received', 'actioned', 'rejected')),
  created_at timestamptz not null default now(),
  actioned_at timestamptz
);

-- Saved copies link back to the shared set so the owner's edits show "Update available".
alter table public.study_guides add column if not exists linked_set_id uuid references public.shared_sets(id) on delete set null;
alter table public.study_guides add column if not exists linked_set_version integer;

-- Three distinct reports hide a set until an admin reviews it (enforced in the database).
create or replace function public.hide_reported_set()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.shared_set_reports where set_id = new.set_id and status = 'open') >= 3 then
    update public.shared_sets set status = 'hidden', updated_at = now()
    where id = new.set_id and status = 'visible';
  end if;
  return new;
end
$$;
revoke execute on function public.hide_reported_set() from public, anon, authenticated;
drop trigger if exists shared_set_reports_hide on public.shared_set_reports;
create trigger shared_set_reports_hide after insert on public.shared_set_reports
for each row execute function public.hide_reported_set();

-- A course an instructor blocked can't be shared to.
create or replace function public.enforce_class_sharing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.visibility = 'class' and (select sharing_blocked from public.classes where id = new.class_id) then
    new.visibility := 'private';
  end if;
  return new;
end
$$;
revoke execute on function public.enforce_class_sharing() from public, anon, authenticated;
drop trigger if exists shared_sets_enforce_block on public.shared_sets;
create trigger shared_sets_enforce_block before insert or update on public.shared_sets
for each row execute function public.enforce_class_sharing();

alter table public.sharing_settings enable row level security;
alter table public.class_share_defaults enable row level security;
alter table public.shared_sets enable row level security;
alter table public.shared_set_studiers enable row level security;
alter table public.shared_set_reports enable row level security;
alter table public.instructor_blocks enable row level security;
alter table public.copyright_takedowns enable row level security;
revoke all on table public.sharing_settings, public.class_share_defaults, public.shared_sets, public.shared_set_studiers,
  public.shared_set_reports, public.instructor_blocks, public.copyright_takedowns from public, anon, authenticated;
grant select on table public.sharing_settings, public.class_share_defaults, public.shared_sets, public.shared_set_studiers, public.shared_set_reports to authenticated;
grant select, insert, update, delete on table public.sharing_settings, public.class_share_defaults, public.shared_sets, public.shared_set_studiers,
  public.shared_set_reports, public.instructor_blocks, public.copyright_takedowns to service_role;

drop policy if exists "Users read own sharing settings" on public.sharing_settings;
create policy "Users read own sharing settings" on public.sharing_settings for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users read own share defaults" on public.class_share_defaults;
create policy "Users read own share defaults" on public.class_share_defaults for select to authenticated using (user_id = auth.uid());
-- Owners read their own sets; class members read visible class sets; nobody else.
drop policy if exists "Owners and class members read shared sets" on public.shared_sets;
create policy "Owners and class members read shared sets" on public.shared_sets for select to authenticated using (
  owner_id = auth.uid()
  or (visibility = 'class' and status = 'visible' and public.is_class_member(class_id))
);
drop policy if exists "Users read own studier rows" on public.shared_set_studiers;
create policy "Users read own studier rows" on public.shared_set_studiers for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users read own reports" on public.shared_set_reports;
create policy "Users read own reports" on public.shared_set_reports for select to authenticated using (reporter_id = auth.uid());
