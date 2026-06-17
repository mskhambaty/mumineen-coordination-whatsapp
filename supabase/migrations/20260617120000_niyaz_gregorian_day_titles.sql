-- Realign Niyaz meal-instance titles to the Gregorian-day convention.
--
-- Previously (20260610140000) dinner titles followed the Islamic night-shift convention,
-- so each date's dinner was labelled as the *next* Moharram day (Jun 15 dinner = "2nd",
-- Jun 16 dinner = "3rd", ...). The admin/catering "Niyaz events" list reads these per-meal
-- titles, producing a confusing off-by-one staircase.
--
-- The intended model is one Moharram number per calendar date, shared by lunch and dinner
-- (this is already what niyaz_event_config.rsvp_event_title uses). This migration:
--   1. Decrements every dinner title (and hijri_date) back to its own day's number.
--   2. Removes the Jun 15 lunch entirely — the 15th (1st Moharram) was dinner-only; no lunch
--      was served. Its niyaz_rsvp / headcount / unregistered rows cascade.
--   3. Deletes the orphan draft event (null date, 0 RSVPs).
-- Pehli Raat (Jun 14) and Ashura (Jun 24) titles are unchanged (Ashura title normalized).

-- 1. Dinner titles: each date's dinner = that date's own Moharram number.
update public.rsvp_registration_instance as ri set
  title = v.new_title,
  hijri_date = v.new_hijri,
  updated_at = now()
from (values
  ('2026-06-15'::date, 'dinner', '1st Moharram ul Haram',  '1 Muharram al-Haram 1448H'),
  ('2026-06-16',       'dinner', '2nd Moharram ul Haram',  '2 Muharram al-Haram 1448H'),
  ('2026-06-17',       'dinner', '3rd Moharram ul Haram',  '3 Muharram al-Haram 1448H'),
  ('2026-06-18',       'dinner', '4th Moharram ul Haram',  '4 Muharram al-Haram 1448H'),
  ('2026-06-19',       'dinner', '5th Moharram ul Haram',  '5 Muharram al-Haram 1448H'),
  ('2026-06-20',       'dinner', '6th Moharram ul Haram',  '6 Muharram al-Haram 1448H'),
  ('2026-06-21',       'dinner', '7th Moharram ul Haram',  '7 Muharram al-Haram 1448H'),
  ('2026-06-22',       'dinner', '8th Moharram ul Haram',  '8 Muharram al-Haram 1448H'),
  ('2026-06-23',       'dinner', '9th Moharram ul Haram',  '9 Muharram al-Haram 1448H'),
  ('2026-06-24',       'dinner', 'Ashura (10th Moharram ul Haram)', '10 Muharram al-Haram 1448H')
) as v(event_date, meal, new_title, new_hijri)
where ri.event_date = v.event_date and ri.meal = v.meal;

-- 2. Remove the Jun 15 lunch (no lunch was served on 1st Moharram). Dependent rows cascade.
delete from public.rsvp_registration_instance
where event_date = '2026-06-15' and meal = 'lunch';

update public.niyaz_event_config
set has_lunch = false, updated_at = now()
where event_date = '2026-06-15';

-- 3. Remove the orphan draft event ("Pehli Raat Niyaz", null date, no RSVPs).
delete from public.rsvp_registration_instance
where id = 'b7b5ca93-af31-49ef-b759-be17ddc57d2d'
  and event_date is null
  and status = 'draft';

commit;
