-- Public "Latest updates" feed for the static relay-center page (see docs/relay-updates.md).
-- Authored by admin/leadership in the portal; served as JSON by GET /api/relay-updates.

create table if not exists public.relay_updates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  body text not null,
  category text not null check (category in ('urgent','schedule','travel','advisory')),
  link text,
  cta text,
  published boolean not null default true,
  created_by uuid references public.whatsapp_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relay_updates_published_date_idx on public.relay_updates (published, date desc);

alter table public.relay_updates enable row level security;

comment on table public.relay_updates is 'Updates shown on the public relay-center page (and indexed for the WhatsApp agent).';
