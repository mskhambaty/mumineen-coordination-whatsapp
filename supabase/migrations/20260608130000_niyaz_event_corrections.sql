-- Niyaz events: correct the Pehli Raat (Jun 14) and the 24th to match the real menu.
-- Jun 14 is a single Pehli Raat thaal (it was seeded as a dinner packet). Jun 24 is a single
-- dinner thaal (drop the lunch thaal). Safe: rsvp_responses is empty and niyaz_rsvp doesn't exist
-- yet (this migration runs before it).

-- Jun 14 — the only event becomes Pehli Raat (thaal).
update public.rsvp_registration_instance
set serving_type = 'thaal',
    title = 'Pehli Raat (thaal) — Sun, Jun 14',
    updated_at = now()
where event_date = '2026-06-14';

-- Jun 24 — drop the lunch thaal; the dinner becomes a thaal.
delete from public.rsvp_registration_instance
where event_date = '2026-06-24' and meal = 'lunch';

update public.rsvp_registration_instance
set serving_type = 'thaal',
    title = 'Dinner (thaal) — Wed, Jun 24',
    updated_at = now()
where event_date = '2026-06-24' and meal = 'dinner';
