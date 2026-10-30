-- Local-only fixture for tests/oauth/run_local_probe.sh: tables shaped like production's
-- sensitive data, with production's own policies (pg_policies, 2026-10-30), plus storage and
-- realtime. Never run against a real project.

create table public.study_guides (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), title text);
alter table public.study_guides enable row level security;
create policy "Users can view own guides" on public.study_guides for select using (auth.uid() = user_id);
create policy "Users can insert own guides" on public.study_guides for insert with check (auth.uid() = user_id);
grant select, insert on public.study_guides to authenticated;

create table public.canvas_courses (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), canvas_course_id bigint, name text, current_grade text);
alter table public.canvas_courses enable row level security;
create policy "Users read own canvas courses" on public.canvas_courses for select to authenticated using (user_id = auth.uid());
grant select, insert on public.canvas_courses to authenticated;
create policy "fixture insert" on public.canvas_courses for insert to authenticated with check (user_id = auth.uid());

create table public.canvas_assignments (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), title text, due_at timestamptz, rubric jsonb);
alter table public.canvas_assignments enable row level security;
create policy "Users read own canvas assignments" on public.canvas_assignments for select to authenticated using (user_id = auth.uid());
create policy "fixture insert" on public.canvas_assignments for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.canvas_assignments to authenticated;

create table public.canvas_tokens (user_id uuid, ciphertext text);
alter table public.canvas_tokens enable row level security;

create table public.connector_settings (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), connector text, stats jsonb);
alter table public.connector_settings enable row level security;
create policy "fixture own" on public.connector_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.connector_settings to authenticated;

create table public.assistant_links (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), phone text);
alter table public.assistant_links enable row level security;
create policy "fixture own" on public.assistant_links for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.assistant_links to authenticated;

create table public.user_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid default auth.uid(), plan text, stripe_customer_id text);
alter table public.user_subscriptions enable row level security;
create policy "own" on public.user_subscriptions for select using (auth.uid() = user_id);
create policy "fixture insert" on public.user_subscriptions for insert with check (auth.uid() = user_id);
grant select, insert on public.user_subscriptions to authenticated;

create table public.user_profiles (id uuid primary key, email text, name text);
alter table public.user_profiles enable row level security;
create policy "Allow insert for authenticated users" on public.user_profiles for insert with check (true);
create policy "Users can read own profile" on public.user_profiles for select using (auth.uid() = id);
grant select, insert on public.user_profiles to authenticated;

create or replace function public.is_class_member(target_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
revoke execute on function public.is_class_member(uuid) from public, anon;
grant execute on function public.is_class_member(uuid) to authenticated;

-- Published for the probe only (production publishes none); applied after the lockdown check runs.
