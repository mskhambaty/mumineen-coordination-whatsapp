-- WhatsApp inbound message coalescing tables.
-- A burst of quick messages from the same user is folded into ONE OpenAI pass
-- and ONE outbound reply using a Postgres-backed lease lock + pending queue.
-- No RPCs — atomicity via insert-then-conditional-update.

-- Lease lock: one per phone_e164 conversation
create table public.whatsapp_inbound_locks (
  lock_key    text primary key,
  owner_token uuid        not null,
  acquired_at timestamptz not null default now(),
  expires_at  timestamptz not null
);
alter table public.whatsapp_inbound_locks enable row level security;

-- Pending message queue
create table public.whatsapp_pending_messages (
  id               uuid primary key default gen_random_uuid(),
  lock_key         text        not null,
  phone_e164       text        not null,
  message_id       text        not null unique,
  body             text        not null,
  inbound_msg_id   uuid,
  received_at      timestamptz not null default now(),
  claimed_at       timestamptz,
  claimed_by       uuid
);
create index idx_wa_pending_drain
  on public.whatsapp_pending_messages (lock_key, received_at);
alter table public.whatsapp_pending_messages enable row level security;
