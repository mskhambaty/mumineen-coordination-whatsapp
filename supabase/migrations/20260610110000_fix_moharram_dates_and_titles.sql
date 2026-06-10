-- Fix Moharram event titles to proper hijri night-first ordering. In the hijri calendar, night
-- comes first (sunset) then day. Lunch = Nth Moharram ul Haram, dinner on the same Gregorian
-- day = (N+1)th Moharram ul Haram (sunset starts the next hijri day). Jun 24 (Ashura / 10th
-- Moharram) is a fasting day — dinner only, titled "Ashura".
--
-- Also inserts the missing Jun 15 lunch event and backfills its niyaz_rsvp attendance.

-- 1. Insert Jun 15 lunch if it doesn't exist yet (may have been added via admin UI).
insert into public.rsvp_registration_instance
  (title, event_date, hijri_date, meal, serving_type, status)
values
  ('1st Moharram ul Haram', '2026-06-15', '1 Muharram al-Haram 1448H', 'lunch', 'thaal', 'open')
on conflict (event_date, meal) do update set
  title = excluded.title,
  hijri_date = excluded.hijri_date,
  serving_type = excluded.serving_type,
  updated_at = now();

-- 2. Fix all dinner titles: on each Gregorian day, dinner = start of next hijri day.
--    Also fix any lunch titles/hijri_dates that may have been manually changed.
update public.rsvp_registration_instance as ri set
  title = v.title,
  hijri_date = v.hijri_date,
  updated_at = now()
from (values
  ('2026-06-14'::date, 'dinner', 'Pehli Raat',              'Eve of 1 Muharram al-Haram 1448H'),
  ('2026-06-15',       'lunch',  '1st Moharram ul Haram',   '1 Muharram al-Haram 1448H'),
  ('2026-06-15',       'dinner', '2nd Moharram ul Haram',   '2 Muharram al-Haram 1448H'),
  ('2026-06-16',       'lunch',  '2nd Moharram ul Haram',   '2 Muharram al-Haram 1448H'),
  ('2026-06-16',       'dinner', '3rd Moharram ul Haram',   '3 Muharram al-Haram 1448H'),
  ('2026-06-17',       'lunch',  '3rd Moharram ul Haram',   '3 Muharram al-Haram 1448H'),
  ('2026-06-17',       'dinner', '4th Moharram ul Haram',   '4 Muharram al-Haram 1448H'),
  ('2026-06-18',       'lunch',  '4th Moharram ul Haram',   '4 Muharram al-Haram 1448H'),
  ('2026-06-18',       'dinner', '5th Moharram ul Haram',   '5 Muharram al-Haram 1448H'),
  ('2026-06-19',       'lunch',  '5th Moharram ul Haram',   '5 Muharram al-Haram 1448H'),
  ('2026-06-19',       'dinner', '6th Moharram ul Haram',   '6 Muharram al-Haram 1448H'),
  ('2026-06-20',       'lunch',  '6th Moharram ul Haram',   '6 Muharram al-Haram 1448H'),
  ('2026-06-20',       'dinner', '7th Moharram ul Haram',   '7 Muharram al-Haram 1448H'),
  ('2026-06-21',       'lunch',  '7th Moharram ul Haram',   '7 Muharram al-Haram 1448H'),
  ('2026-06-21',       'dinner', '8th Moharram ul Haram',   '8 Muharram al-Haram 1448H'),
  ('2026-06-22',       'lunch',  '8th Moharram ul Haram',   '8 Muharram al-Haram 1448H'),
  ('2026-06-22',       'dinner', '9th Moharram ul Haram',   '9 Muharram al-Haram 1448H'),
  ('2026-06-23',       'lunch',  '9th Moharram ul Haram',   '9 Muharram al-Haram 1448H'),
  ('2026-06-23',       'dinner', '10th Moharram ul Haram',  '10 Muharram al-Haram 1448H'),
  ('2026-06-24',       'dinner', 'Ashura',                  '10 Muharram al-Haram 1448H')
) as v(event_date, meal, title, hijri_date)
where ri.event_date = v.event_date and ri.meal = v.meal;

-- 3. Backfill niyaz_rsvp rows for the newly inserted Jun 15 lunch event.
--    Same arrival-date logic as seed_family_niyaz_rsvp / 20260609140000_niyaz_backfill_from_arrival.
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
where i.event_date = '2026-06-15' and i.meal = 'lunch'
  and m.roster_active = true
  and f.registration_status in ('submitted', 'confirmed')
on conflict (registration_instance_id, mumin_id) do nothing;
