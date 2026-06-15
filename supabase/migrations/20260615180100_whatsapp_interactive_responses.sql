-- Raw capture of inbound WhatsApp interactive responses — Flow completions (nfm_reply) and button
-- taps — so nothing is lost. Phase 1 only STORES the response; decoding it into a niyaz RSVP is
-- phase 2. The self-describing tokens we send are stored verbatim for that later decode:
--   flow_token            "rsvp:<muminId>:<registrationInstanceId>"
--   quick-reply payload   "not-attending-<muminId>-<registrationInstanceId>"

create table if not exists public.whatsapp_interactive_responses (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  wa_message_id text,
  response_type text not null check (response_type in ('flow', 'button')),
  flow_token text,
  payload jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_interactive_responses_phone_idx on public.whatsapp_interactive_responses (phone_e164);
create index if not exists whatsapp_interactive_responses_flow_token_idx on public.whatsapp_interactive_responses (flow_token);

-- RLS on (service-role app access only — no policies, matching the other webhook-fed tables).
alter table public.whatsapp_interactive_responses enable row level security;
