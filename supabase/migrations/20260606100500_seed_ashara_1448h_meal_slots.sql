-- Seed the meal-slot grid for Ashara Mubaraka 1448H (Chicago).
-- Pheli Raat: Sun Jun 14 = dinner only. Mon Jun 15 .. Wed Jun 24 (Ashura) = lunch + dinner.
-- Lunch (thaal) served 1:30pm; dinner (packets) served 8:30pm, America/Chicago.
-- Idempotent via the unique (event_date, meal) index. Seeded 'open' so RSVP capture can run.

with days as (
  select d::date as event_date
  from generate_series('2026-06-14'::date, '2026-06-24'::date, interval '1 day') as g(d)
),
slots as (
  select event_date, meal
  from days
  cross join (values ('lunch'), ('dinner')) as m(meal)
  where not (event_date = date '2026-06-14' and meal = 'lunch')  -- Pheli Raat is dinner only
)
insert into public.rsvp_registration_instance
  (title, meal, event_date, serving_type, event_at, opens_at, closes_at, status, venue_name)
select
  case when meal = 'lunch' then 'Lunch (thaal) — ' else 'Dinner (packets) — ' end
    || to_char(event_date, 'Dy, Mon FMDD'),
  meal,
  event_date,
  case when meal = 'lunch' then 'thaal' else 'packet' end,
  (event_date + case when meal = 'lunch' then time '13:30' else time '20:30' end)
    at time zone 'America/Chicago',
  timestamp '2026-06-12 09:00' at time zone 'America/Chicago',
  (event_date + case when meal = 'lunch' then time '13:30' else time '20:30' end)
    at time zone 'America/Chicago',
  'open',
  'Markaz'
from slots
on conflict (event_date, meal) where event_date is not null and meal is not null
do nothing;
