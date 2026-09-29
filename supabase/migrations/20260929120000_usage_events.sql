-- One row per OpenAI call (model, feature, tokens) so real spend per feature/user is visible.
-- Written only by the FastAPI service (service_role); browser clients get no access.

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  feature text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cached_tokens integer not null default 0
);

create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_feature_idx on public.usage_events (feature, created_at desc);

alter table public.usage_events enable row level security;
revoke all on table public.usage_events from public, anon, authenticated;
grant insert on table public.usage_events to service_role;
