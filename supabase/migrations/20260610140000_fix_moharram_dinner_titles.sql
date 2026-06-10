-- Fix Moharram dinner event titles (off-by-one) and insert the missing Jun 17 dinner.
-- Pehli Raat = 1st Moharram Night; Jun 15 lunch = 1st Moharram Day (kept).

-- 1. Fix all dinner titles: each was labeled one Moharram number too low.
--    Pattern: Nth Moharram dinner = Jun (13+N), so Jun 15 dinner = 2nd, Jun 16 = 3rd, etc.
update public.rsvp_registration_instance as ri set
  title = v.new_title,
  hijri_date = v.new_hijri,
  updated_at = now()
from (values
  ('2026-06-15'::date, 'dinner', '2nd Moharram ul Haram',  '2 Muharram al-Haram 1448H'),
  ('2026-06-16',       'dinner', '3rd Moharram ul Haram',  '3 Muharram al-Haram 1448H'),
  ('2026-06-18',       'dinner', '5th Moharram ul Haram',  '5 Muharram al-Haram 1448H'),
  ('2026-06-19',       'dinner', '6th Moharram ul Haram',  '6 Muharram al-Haram 1448H'),
  ('2026-06-20',       'dinner', '7th Moharram ul Haram',  '7 Muharram al-Haram 1448H'),
  ('2026-06-21',       'dinner', '8th Moharram ul Haram',  '8 Muharram al-Haram 1448H'),
  ('2026-06-22',       'dinner', '9th Moharram ul Haram',  '9 Muharram al-Haram 1448H'),
  ('2026-06-23',       'dinner', '10th Moharram ul Haram', '10 Muharram al-Haram 1448H'),
  ('2026-06-24',       'dinner', 'Ashura',                 '10 Muharram al-Haram 1448H')
) as v(event_date, meal, new_title, new_hijri)
where ri.event_date = v.event_date and ri.meal = v.meal;

-- 2. Insert the missing Jun 17 dinner "4th Moharram ul Haram" (packet).
insert into public.rsvp_registration_instance
  (title, event_date, hijri_date, meal, serving_type, status)
values
  ('4th Moharram ul Haram', '2026-06-17', '4 Muharram al-Haram 1448H', 'dinner', 'packet', 'open');

-- 3. Backfill niyaz_rsvp rows for the new Jun 17 dinner event using arrival-date logic.
insert into public.niyaz_rsvp (registration_instance_id, mumin_id, family_id, attending, source)
select
  ri.id,
  m.id,
  f.id,
  case
    when m.not_attending then false
    when m.arrival_at is null then true
    when (m.arrival_at at time zone 'America/Chicago')::date <= ri.event_date then true
    else false
  end,
  'default'
from public.rsvp_registration_instance ri
cross join public.mumineen m
join public.families f on f.hof_its = m.hof_its
where ri.event_date = '2026-06-17'
  and ri.meal = 'dinner'
  and m.roster_active = true
on conflict (registration_instance_id, mumin_id) do nothing;
