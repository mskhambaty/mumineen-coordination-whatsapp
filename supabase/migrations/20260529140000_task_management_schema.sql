-- Migration: Task management schema additions
-- Adds global_role, transcript_aliases, email to whatsapp_users
-- Creates departments, department_members, tasks, conversation_uploads, conversation_events

-- 1a. Add global_role to whatsapp_users
alter table public.whatsapp_users
  add column global_role text not null default 'member'
  check (global_role in ('member', 'pm', 'hod', 'leadership_admin'));

-- 6. Add transcript_aliases and email columns
alter table public.whatsapp_users
  add column if not exists transcript_aliases text[] not null default '{}';

alter table public.whatsapp_users
  add column if not exists email text;

-- 1b. Departments table
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;

-- 1c. Department members table
create table public.department_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references public.whatsapp_users(id) on delete cascade,
  dept_role text not null check (dept_role in ('hod', 'pm', 'member')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(department_id, user_id)
);

alter table public.department_members enable row level security;

-- 1d. Tasks table
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'complete')),
  assigned_to uuid references public.whatsapp_users(id) on delete set null,
  created_by uuid references public.whatsapp_users(id) on delete set null,
  source text not null default 'manual' check (source in ('transcript', 'whatsapp_agent', 'manual')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

-- updated_at trigger for tasks
create or replace function public.set_tasks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_tasks_updated_at();

-- 1e. Conversation uploads table
create table public.conversation_uploads (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  uploaded_by uuid references public.whatsapp_users(id) on delete set null,
  filename text,
  group_name text,
  raw_content text not null,
  parsed_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.conversation_uploads enable row level security;

-- 1f. Conversation events table
create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.conversation_uploads(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  event_type text not null check (event_type in ('task_created','task_updated','task_completed','decision','info')),
  task_id uuid references public.tasks(id) on delete set null,
  sender_alias text,
  sender_user_id uuid references public.whatsapp_users(id) on delete set null,
  message_text text,
  message_timestamp timestamptz,
  ai_summary text,
  confidence float,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.conversation_events enable row level security;

-- Indexes
create index idx_tasks_department_id on public.tasks(department_id);
create index idx_tasks_status on public.tasks(status);
create index idx_tasks_assigned_to on public.tasks(assigned_to);
create index idx_department_members_user_id on public.department_members(user_id);
create index idx_department_members_department_id on public.department_members(department_id);
create index idx_conversation_events_upload_id on public.conversation_events(upload_id);
create index idx_conversation_uploads_department_id on public.conversation_uploads(department_id);

-- 1h. Helper SQL function
create or replace function public.get_user_permissions(p_phone text)
returns jsonb language plpgsql as $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
begin
  select * into u from public.whatsapp_users where phone_e164 = p_phone;
  if not found then return '{"global_role":"unknown"}'::jsonb; end if;
  if u.global_role = 'leadership_admin' then
    return jsonb_build_object(
      'user_id', u.id, 'display_name', u.display_name,
      'global_role', u.global_role,
      'can_read_all', true, 'can_write_all', true
    );
  end if;
  select jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) into dept_roles
  from public.department_members dm
  join public.departments d on d.id = dm.department_id
  where dm.user_id = u.id and dm.is_active = true;
  return jsonb_build_object(
    'user_id', u.id, 'display_name', u.display_name,
    'global_role', u.global_role,
    'can_read_all', false, 'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb)
  );
end; $$;
