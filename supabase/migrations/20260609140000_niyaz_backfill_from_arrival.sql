-- Re-seed arrival-date default attendance for the finalized 19 Niyaz events. Runs after the event
-- recreate (20260609130000), which cascade-cleared niyaz_rsvp. Default rule (America/Chicago calendar
-- date): not_attending => No; no arrival_at => Yes (present all of Ashara, e.g. locals); else Yes when
-- event_date >= arrival date. Idempotent — existing rows (incl. whatsapp/admin overrides) are kept.

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
