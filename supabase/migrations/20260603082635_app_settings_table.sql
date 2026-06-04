-- App-wide key/value runtime flags toggled from the admin UI (e.g. the WhatsApp registration gate).
-- Reconstructed from the live database.

create table public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_settings enable row level security;

comment on table public.app_settings is 'App-wide key/value runtime flags toggled from the admin UI (service-role only).';
