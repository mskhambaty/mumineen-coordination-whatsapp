-- Escalation & site support: conversation escalation state, support membership
-- with on-call hours, and external/internal origin for issues.

-- 1. Escalation state on conversations (orthogonal to handling_mode; AI stays on).
alter table public.conversation_sessions
  add column if not exists escalation_status text not null default 'none'
    check (escalation_status in ('none', 'pending', 'resolved')),
  add column if not exists escalation_reason text,
  add column if not exists escalation_priority text not null default 'normal'
    check (escalation_priority in ('normal', 'urgent')),
  add column if not exists escalation_category text,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_source text
    check (escalation_source in ('ai', 'rule', 'manual'));

create index if not exists conversation_sessions_escalation_status_idx
  on public.conversation_sessions (escalation_status);

-- 2. Escalation/support membership. Being a row here IS the role.
create table if not exists public.escalation_support_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.whatsapp_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.escalation_support_members enable row level security;

-- 3. On-call hours: weekly recurring, evaluated in America/Chicago.
create table if not exists public.escalation_oncall_hours (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.escalation_support_members(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);

alter table public.escalation_oncall_hours enable row level security;

create index if not exists escalation_oncall_hours_member_id_idx
  on public.escalation_oncall_hours (member_id);

-- 4. Issue origin: external (raised from the inbox) vs internal (team blockers).
alter table public.tasks
  add column if not exists origin text not null default 'internal'
    check (origin in ('external', 'internal'));

create index if not exists tasks_origin_idx on public.tasks (origin);
