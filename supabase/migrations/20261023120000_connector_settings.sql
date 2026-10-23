-- Connector settings (NOT APPLIED: waiting for the owner's OK).
--
-- Each app in Settings > Connectors can be switched on or off for the Tutor and for Cordia
-- Assistant separately; the app stays connected either way. No row means both are on.
-- Classroom's backend writes it (service role); Cordia Assistant reads it (same project, service
-- role) to leave switched-off apps out of its tools.

create table if not exists public.connector_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null check (char_length(connector) <= 40),
  tutor boolean not null default true,
  assistant boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, connector)
);

alter table public.connector_settings enable row level security;
revoke all on table public.connector_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.connector_settings to service_role;
