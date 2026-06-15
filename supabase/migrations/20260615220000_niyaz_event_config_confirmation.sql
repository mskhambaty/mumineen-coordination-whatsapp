-- Per-day RSVP confirmation template config. After a family responds, phase 2 sends this template
-- back to them (echoing their RSVP, with a "change" button). It's sent reactively, so its template +
-- variable bindings + button payloads are persisted on the day for phase 2 to resolve per responder.

alter table public.niyaz_event_config
  add column if not exists confirmation_template_code text,
  add column if not exists confirmation_variable_bindings jsonb,
  add column if not exists confirmation_buttons jsonb;
