-- RSVP cutoff as a real timestamp. After this instant, late interactive responses are rejected with a
-- "registration has ended" reply instead of being recorded. The old free-text rsvp_end_time column is
-- kept for back-compat / display fallback; the template's {{rsvp_end_time}} now renders rsvp_end_at.

alter table public.niyaz_event_config
  add column if not exists rsvp_end_at timestamptz;
