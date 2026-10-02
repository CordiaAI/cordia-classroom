-- CordiaClassroom Pro: per-feature usage ledger, no-card trial tracking, entitlement source.
-- Additive only. Legacy monthly_usage / free_plan_usage / trial_used / trial_ends_at are no
-- longer read by the backend and can be dropped after the new code has run for one month.

alter table public.user_subscriptions
  add column if not exists source text not null default 'stripe',
  add column if not exists current_period_start timestamptz,
  add column if not exists pro_trial_started_at timestamptz,
  add column if not exists pro_trial_ends_at timestamptz,
  add column if not exists trial_end_prompted_at timestamptz;

do $$ begin
  alter table public.user_subscriptions
    add constraint user_subscriptions_source_check check (source in ('stripe', 'manual'));
exception when duplicate_object then null; end $$;

-- Access granted directly in the database (no Stripe subscription) is labelled, not silent.
update public.user_subscriptions
   set source = 'manual'
 where stripe_subscription_id is null
   and plan in ('pro', 'classroom_plus')
   and status in ('active', 'trialing');

-- One row per charged AI action. Counts are derived, so they can never drift or lose
-- concurrent increments; request_key makes client retries free.
create table if not exists public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in
    ('guide', 'tutor', 'learn_my_way', 'practice', 'ai_quiz', 'nclex', 'exam', 'light')),
  month text not null,
  request_key text,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_user_month_idx on public.usage_ledger (user_id, month, feature);
create unique index if not exists usage_ledger_request_key_idx
  on public.usage_ledger (user_id, request_key) where request_key is not null;

alter table public.usage_ledger enable row level security;
revoke all on public.usage_ledger from anon, authenticated;

create or replace function public.record_feature_usage(
  p_user_id uuid, p_feature text, p_month text, p_request_key text default null
) returns boolean
language sql
set search_path = public
as $$
  with inserted as (
    insert into public.usage_ledger (user_id, feature, month, request_key)
    values (p_user_id, p_feature, p_month, p_request_key)
    on conflict (user_id, request_key) where request_key is not null do nothing
    returning 1
  )
  select exists (select 1 from inserted);
$$;

create or replace function public.feature_usage_counts(p_user_id uuid, p_month text)
returns table (feature text, used bigint)
language sql
stable
set search_path = public
as $$
  select feature, count(*) from public.usage_ledger
   where user_id = p_user_id and month = p_month
   group by feature;
$$;

revoke execute on function public.record_feature_usage(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.feature_usage_counts(uuid, text) from public, anon, authenticated;
