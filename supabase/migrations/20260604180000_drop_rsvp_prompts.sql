-- Revert the Niyaz-page WhatsApp send/auto-capture: the rsvp_prompts tracking table is no longer
-- used (RSVP prompts will be sent from the general WhatsApp communication page later).
drop table if exists public.rsvp_prompts cascade;
drop function if exists public.set_rsvp_prompts_updated_at();
