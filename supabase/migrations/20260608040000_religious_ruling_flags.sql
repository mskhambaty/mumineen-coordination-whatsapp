-- Lightweight "flag" store for personal religious-ruling (fatwa) questions.
-- Distinct from escalation: flagging is awareness-only — no on-call ping, no pending hand-off.
-- The agent refuses to answer rulings (redirecting to the Aamil Saheb) and records a row here so
-- the team has visibility into what's being asked. RLS is enabled with no policies, so the table
-- is reachable only via the service role (getSupabaseAdmin), never from the client.

create table if not exists public.religious_ruling_flags (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  message text not null,
  detected_by text not null check (detected_by in ('keyword','classifier')),
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.religious_ruling_flags enable row level security;

create index if not exists religious_ruling_flags_created_at_idx
  on public.religious_ruling_flags (created_at desc);
