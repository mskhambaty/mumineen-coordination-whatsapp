-- Per-mumin Niyaz attendance. One row per (event, mumin); `attending` is pre-set from each
-- person's arrival date and later overridden by the WhatsApp bot or an admin. Replaces the
-- per-family head-count model in rsvp_responses (which is left in place, empty, for now).

create table if not exists public.niyaz_rsvp (
  id uuid primary key default gen_random_uuid(),
  registration_instance_id uuid not null references public.rsvp_registration_instance(id) on delete cascade,
  mumin_id uuid not null references public.mumineen(id) on delete cascade,
  family_id uuid references public.families(id) on delete set null,
  attending boolean not null,
  source text not null default 'default',
  responded_by_phone text,
  recorded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint niyaz_rsvp_source_check check (source in ('default', 'registration', 'whatsapp', 'admin')),
  constraint niyaz_rsvp_instance_mumin_key unique (registration_instance_id, mumin_id)
);

create index if not exists niyaz_rsvp_instance_idx on public.niyaz_rsvp (registration_instance_id);
create index if not exists niyaz_rsvp_mumin_idx on public.niyaz_rsvp (mumin_id);
create index if not exists niyaz_rsvp_family_idx on public.niyaz_rsvp (family_id);

-- RLS on (service-role app access only — no policies, matching the other rsvp tables).
alter table public.niyaz_rsvp enable row level security;

create or replace function public.set_niyaz_rsvp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists niyaz_rsvp_updated_at on public.niyaz_rsvp;
create trigger niyaz_rsvp_updated_at
  before update on public.niyaz_rsvp
  for each row execute function public.set_niyaz_rsvp_updated_at();

-- (Re)seed a single family's per-mumin attendance from current arrival dates. Called by the
-- registration submit/edit. Never clobbers a whatsapp/admin override — only default/registration
-- rows are recomputed.
create or replace function public.seed_family_niyaz_rsvp(p_family_id uuid)
returns void as $$
  insert into public.niyaz_rsvp (registration_instance_id, mumin_id, family_id, attending, source)
  select i.id, m.id, m.family_id,
    case
      when m.not_attending then false
      when m.arrival_at is null then true
      else ((m.arrival_at at time zone 'America/Chicago')::date <= i.event_date)
    end,
    'registration'
  from public.rsvp_registration_instance i
  cross join public.mumineen m
  where m.family_id = p_family_id
    and m.roster_active = true
    and i.event_date is not null
  on conflict (registration_instance_id, mumin_id) do update
    set attending = excluded.attending,
        source = 'registration',
        updated_at = now()
    where niyaz_rsvp.source in ('default', 'registration');
$$ language sql;
