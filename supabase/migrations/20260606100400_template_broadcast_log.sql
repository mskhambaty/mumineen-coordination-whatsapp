-- Manual template-send console: one broadcast row per "press Send", plus a per-recipient row so
-- the log can show delivered/read/replied (fed back from Meta status webhooks) and the free vs
-- paid (24h-window) split. PII (phone) lives here in the DB by design — it is RLS-protected and
-- only reached through src/app/api/admin/**.

create table if not exists public.template_broadcasts (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  template_language text not null default 'en_US',
  audience_key text not null,
  triggered_by_user_id uuid references public.whatsapp_users(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_recipients integer not null default 0,
  count_free integer not null default 0,       -- inside 24h window at send time
  count_paid integer not null default 0,       -- outside 24h window at send time
  count_excluded integer not null default 0,   -- no WhatsApp number on file
  count_sent integer not null default 0,
  count_failed integer not null default 0,
  est_cost_usd numeric(10,2) not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists template_broadcasts_started_idx
  on public.template_broadcasts (started_at desc);

create table if not exists public.template_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.template_broadcasts(id) on delete cascade,
  family_id uuid references public.families(id) on delete set null,
  phone_e164 text not null,
  was_in_window boolean not null default false,
  wa_message_id text,
  send_status text not null default 'queued'
    check (send_status in ('queued', 'sent', 'failed', 'delivered', 'read', 'replied')),
  error_detail text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz
);

-- Status webhooks look recipients up by the Meta message id.
create index if not exists template_broadcast_recipients_wamid_idx
  on public.template_broadcast_recipients (wa_message_id);
create index if not exists template_broadcast_recipients_broadcast_idx
  on public.template_broadcast_recipients (broadcast_id);

alter table public.template_broadcasts enable row level security;
alter table public.template_broadcast_recipients enable row level security;
