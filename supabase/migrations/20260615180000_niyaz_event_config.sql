-- Day-level Niyaz event configuration, keyed by event_date. The per-meal
-- rsvp_registration_instance rows remain the RSVP/tally source of truth; this table only holds the
-- template-facing, admin-editable fields the daily RSVP broadcast needs: the event title, the
-- lunch/dinner menus, the RSVP cutoff time, which meals are offered (lunch / dinner / both), and the
-- template to send. One row per day (a "niyaz event" = 1st Moharram, 2nd Moharram, …).

create table if not exists public.niyaz_event_config (
  event_date date primary key,
  rsvp_event_title text,
  lunch_menu text,
  dinner_menu text,
  rsvp_end_time text,
  has_lunch boolean not null default false,
  has_dinner boolean not null default false,
  template_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS on (service-role app access only — no policies, matching the other rsvp tables).
alter table public.niyaz_event_config enable row level security;

create or replace function public.set_niyaz_event_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists niyaz_event_config_updated_at on public.niyaz_event_config;
create trigger niyaz_event_config_updated_at
  before update on public.niyaz_event_config
  for each row execute function public.set_niyaz_event_config_updated_at();
