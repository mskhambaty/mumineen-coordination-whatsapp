-- Prefill the 10 Niyaz days for Ashara Mubaraka 1448H — 1st–10th Moharram ul Haram (15–24 Jun 2026)
-- — into niyaz_event_config (the day-level config the RSVP broadcast reads). Idempotent: a row that
-- already exists for a date is left untouched. Meals default to both; admins adjust per day, fill the
-- menus / RSVP end time, and pick the template from the Niyaz days page.

insert into public.niyaz_event_config (event_date, rsvp_event_title, has_lunch, has_dinner, template_code)
values
  ('2026-06-15', '1st Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-16', '2nd Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-17', '3rd Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-18', '4th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-19', '5th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-20', '6th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-21', '7th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-22', '8th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-23', '9th Moharram ul Haram', true, true, 'ashara_relay_double_rsvp'),
  ('2026-06-24', '10th Moharram ul Haram (Ashura)', true, true, 'ashara_relay_double_rsvp')
on conflict (event_date) do nothing;
