-- One-time backfill: default per-mumin attendance for every already-registered, active mumin
-- across every Niyaz event, from each person's arrival date. not_attending => no; no arrival on
-- file => yes (assume present all of Ashara); otherwise yes when event_date >= arrival date
-- (America/Chicago calendar date). Idempotent: existing rows are left untouched.

insert into public.niyaz_rsvp (registration_instance_id, mumin_id, family_id, attending, source)
select i.id, m.id, m.family_id,
  case
    when m.not_attending then false
    when m.arrival_at is null then true
    else ((m.arrival_at at time zone 'America/Chicago')::date <= i.event_date)
  end,
  'default'
from public.rsvp_registration_instance i
cross join public.mumineen m
join public.families f on f.id = m.family_id
where i.event_date is not null
  and m.roster_active = true
  and f.registration_status in ('submitted', 'confirmed')
on conflict (registration_instance_id, mumin_id) do nothing;
