-- Unregistered RSVPs: collect attendance from phone numbers not linked to a registered family.
-- Also makes niyaz_rsvp_prompts.family_id nullable so unregistered callers can receive
-- head-count prompts and reply with a family count.

create table if not exists public.unregistered_rsvps (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  registration_instance_id uuid not null
    references public.rsvp_registration_instance(id) on delete cascade,
  adults integer not null default 1,
  kids integer not null default 0,
  attending boolean not null default true,
  its_number text,
  family_name text,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unregistered_rsvps_phone_instance_key
    unique (phone_e164, registration_instance_id),
  constraint unregistered_rsvps_adults_check check (adults >= 0),
  constraint unregistered_rsvps_kids_check check (kids >= 0),
  constraint unregistered_rsvps_source_check
    check (source in ('whatsapp', 'admin'))
);

create index if not exists unregistered_rsvps_phone_idx
  on public.unregistered_rsvps (phone_e164);
create index if not exists unregistered_rsvps_instance_idx
  on public.unregistered_rsvps (registration_instance_id);

alter table public.unregistered_rsvps enable row level security;

create or replace function public.set_unregistered_rsvps_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger unregistered_rsvps_updated_at
  before update on public.unregistered_rsvps
  for each row execute function public.set_unregistered_rsvps_updated_at();

-- Allow unregistered callers to receive head-count prompts.
alter table public.niyaz_rsvp_prompts alter column family_id drop not null;
