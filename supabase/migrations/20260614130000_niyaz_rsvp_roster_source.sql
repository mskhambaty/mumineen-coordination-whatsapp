-- Add a 'roster' source for niyaz_rsvp rows belonging to mumineen whose family has NOT registered
-- (families.registration_status <> 'submitted'). These are still unconfirmed assumptions — counted
-- in the "max" tally, excluded from the whatsapp/admin "min" tally, exactly like 'default' — but now
-- clearly distinguish "on the roster, family hasn't registered" from an arrival-date default.

-- 1. Allow the new source value.
alter table public.niyaz_rsvp drop constraint if exists niyaz_rsvp_source_check;
alter table public.niyaz_rsvp add constraint niyaz_rsvp_source_check
  check (source in ('default', 'registration', 'whatsapp', 'admin', 'roster'));

-- 2. Re-tag existing 'default' rows for not-registered families as 'roster'. Idempotent: only touches
-- source='default' rows of non-submitted families; confirmed whatsapp/admin rows are never changed.
update public.niyaz_rsvp r
set source = 'roster', updated_at = now()
from public.mumineen m
join public.families f on f.id = m.family_id
where r.mumin_id = m.id
  and r.source = 'default'
  and coalesce(f.registration_status, '') <> 'submitted';

-- 3. Ensure registration still overwrites 'roster' rows: when a not-registered family later submits,
-- seed_family_niyaz_rsvp must recompute attendance and bump their rows to 'registration'. Add 'roster'
-- to the conflict-update guard (previously only 'default'/'registration').
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
    where niyaz_rsvp.source in ('default', 'registration', 'roster');
$$ language sql;
