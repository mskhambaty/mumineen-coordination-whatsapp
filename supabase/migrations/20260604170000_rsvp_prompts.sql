-- Outbound RSVP prompt tracking + per-recipient flow state. This is what correlates an inbound
-- WhatsApp reply back to a Niyaz instance + family (quick-reply button payloads are static, so we
-- can't carry the instance id in the button itself — we track the outstanding prompt per phone).

create table public.rsvp_prompts (
  id uuid primary key default gen_random_uuid(),
  registration_instance_id uuid not null references public.rsvp_registration_instance(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  mumin_id uuid references public.mumineen(id) on delete set null,
  phone_e164 text not null,
  mode text not null default 'text_plain' check (mode in ('button', 'text', 'text_plain')),
  wa_message_id text,
  -- Flow state: 'sent' (awaiting yes/no/maybe), 'awaiting_head_count' (got yes, need a number),
  -- 'done' (recorded, or superseded by a newer prompt to the same phone).
  stage text not null default 'sent' check (stage in ('sent', 'awaiting_head_count', 'done')),
  pending_response text check (pending_response in ('yes', 'no', 'maybe')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook looks up the latest active prompt for an inbound phone.
create index rsvp_prompts_phone_idx on public.rsvp_prompts (phone_e164, sent_at desc);
create index rsvp_prompts_instance_idx on public.rsvp_prompts (registration_instance_id);

alter table public.rsvp_prompts enable row level security;

create or replace function public.set_rsvp_prompts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists rsvp_prompts_updated_at on public.rsvp_prompts;
create trigger rsvp_prompts_updated_at
  before update on public.rsvp_prompts
  for each row execute function public.set_rsvp_prompts_updated_at();
