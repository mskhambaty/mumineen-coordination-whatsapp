-- Add a Hijri date to Niyaz events and recreate the finalized 19-event list. Safe to recreate: at
-- this point there are no RSVP responses, so the FK cascade on delete is a no-op. Final set:
-- Pehli Raat (Jun 14 dinner), 1st Moharram (Jun 15 dinner only), 2nd–9th Moharram (Jun 16–23 lunch +
-- dinner), 10th Moharram (Jun 24 dinner only). Lunch = thaal, dinner = packet, except Pehli Raat and
-- the 10th (dinner thaal).

alter table public.rsvp_registration_instance add column if not exists hijri_date text;

delete from public.rsvp_registration_instance where event_date is not null;

insert into public.rsvp_registration_instance (title, event_date, hijri_date, meal, serving_type, status)
values
  ('Pehli Raat',            '2026-06-14', 'Eve of 1 Muharram al-Haram 1448H', 'dinner', 'thaal',  'open'),
  ('1st Moharram ul Haram', '2026-06-15', '1 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('2nd Moharram ul Haram', '2026-06-16', '2 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('2nd Moharram ul Haram', '2026-06-16', '2 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('3rd Moharram ul Haram', '2026-06-17', '3 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('3rd Moharram ul Haram', '2026-06-17', '3 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('4th Moharram ul Haram', '2026-06-18', '4 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('4th Moharram ul Haram', '2026-06-18', '4 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('5th Moharram ul Haram', '2026-06-19', '5 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('5th Moharram ul Haram', '2026-06-19', '5 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('6th Moharram ul Haram', '2026-06-20', '6 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('6th Moharram ul Haram', '2026-06-20', '6 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('7th Moharram ul Haram', '2026-06-21', '7 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('7th Moharram ul Haram', '2026-06-21', '7 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('8th Moharram ul Haram', '2026-06-22', '8 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('8th Moharram ul Haram', '2026-06-22', '8 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('9th Moharram ul Haram', '2026-06-23', '9 Muharram al-Haram 1448H',        'lunch',  'thaal',  'open'),
  ('9th Moharram ul Haram', '2026-06-23', '9 Muharram al-Haram 1448H',        'dinner', 'packet', 'open'),
  ('10th Moharram ul Haram','2026-06-24', '10 Muharram al-Haram 1448H',       'dinner', 'thaal',  'open');
