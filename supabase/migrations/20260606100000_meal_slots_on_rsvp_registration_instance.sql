-- Turn rsvp_registration_instance into the meal-slot grid for the 10 days of Ashara meals.
-- Each row = one meal on one day (lunch=thaal, dinner=packet). Reuses the existing
-- title/event_at/venue/status/opens_at/closes_at columns; adds meal categorization + a
-- unique (event_date, meal) guard so the seed (and any "regenerate") is idempotent.

alter table public.rsvp_registration_instance
  add column if not exists meal text,
  add column if not exists event_date date,
  add column if not exists serving_type text;

alter table public.rsvp_registration_instance
  drop constraint if exists rsvp_registration_instance_meal_check;
alter table public.rsvp_registration_instance
  add constraint rsvp_registration_instance_meal_check
  check (meal is null or meal in ('lunch', 'dinner'));

alter table public.rsvp_registration_instance
  drop constraint if exists rsvp_registration_instance_serving_type_check;
alter table public.rsvp_registration_instance
  add constraint rsvp_registration_instance_serving_type_check
  check (serving_type is null or serving_type in ('thaal', 'packet'));

-- One slot per (day, meal). Partial so legacy non-meal instances (null) are unaffected.
create unique index if not exists rsvp_registration_instance_day_meal_key
  on public.rsvp_registration_instance (event_date, meal)
  where event_date is not null and meal is not null;

-- Grid reads group by day.
create index if not exists rsvp_registration_instance_event_date_idx
  on public.rsvp_registration_instance (event_date);
