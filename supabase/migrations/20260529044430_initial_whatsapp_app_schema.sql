create table if not exists public.whatsapp_users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique not null,
  display_name text,
  role text not null default 'visitor' check (role in ('visitor', 'committee', 'admin')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  jamaat text,
  city text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  whatsapp_message_id text unique,
  body text,
  message_type text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  user_id uuid references public.whatsapp_users(id) on delete set null,
  current_intent text,
  state jsonb not null default '{}',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.committee_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.whatsapp_users(id) on delete cascade,
  permission_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, permission_key)
);

create table if not exists public.tool_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.whatsapp_users(id) on delete set null,
  phone_e164 text,
  tool_name text not null,
  arguments jsonb,
  allowed boolean not null,
  result_summary text,
  created_at timestamptz not null default now()
);

create index if not exists messages_phone_e164_created_at_idx
  on public.messages (phone_e164, created_at desc);

create index if not exists tool_audit_logs_user_id_created_at_idx
  on public.tool_audit_logs (user_id, created_at desc);

create index if not exists committee_permissions_permission_key_idx
  on public.committee_permissions (permission_key);

create index if not exists conversation_sessions_user_id_idx
  on public.conversation_sessions (user_id);

create or replace function public.set_whatsapp_users_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_whatsapp_users_updated_at on public.whatsapp_users;

create trigger set_whatsapp_users_updated_at
before update on public.whatsapp_users
for each row
execute function public.set_whatsapp_users_updated_at();

alter table public.whatsapp_users enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_sessions enable row level security;
alter table public.committee_permissions enable row level security;
alter table public.tool_audit_logs enable row level security;
