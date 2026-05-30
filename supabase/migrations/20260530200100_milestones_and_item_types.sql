-- Milestones table and item_type expansion for tasks and events.

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  description text,
  budget numeric(12,2),
  percent_complete integer not null default 0
    check (percent_complete >= 0 and percent_complete <= 100),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'complete')),
  notes text,
  created_by uuid references public.whatsapp_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.milestones enable row level security;

create index if not exists milestones_department_id_idx on public.milestones (department_id);
create index if not exists milestones_status_idx on public.milestones (status);

create or replace function public.set_milestones_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger milestones_updated_at
  before update on public.milestones
  for each row execute function public.set_milestones_updated_at();

-- Add milestone_id and item_type to tasks.
alter table public.tasks
  add column if not exists milestone_id uuid references public.milestones(id) on delete set null;

alter table public.tasks
  add column if not exists item_type text not null default 'task'
  check (item_type in ('task', 'issue'));

create index if not exists tasks_milestone_id_idx on public.tasks (milestone_id);
create index if not exists tasks_item_type_idx on public.tasks (item_type);

-- Expand conversation_events for milestones and issues.
alter table public.conversation_events
  drop constraint if exists conversation_events_event_type_check;

alter table public.conversation_events
  add constraint conversation_events_event_type_check
  check (event_type in (
    'task_created', 'task_updated', 'task_completed',
    'milestone_created', 'milestone_updated',
    'issue_created', 'issue_updated', 'issue_resolved',
    'decision', 'info'
  ));

alter table public.conversation_events
  add column if not exists milestone_id uuid references public.milestones(id) on delete set null;

alter table public.conversation_events
  add column if not exists item_type text default 'task'
  check (item_type in ('task', 'issue', 'milestone'));

alter table public.conversation_events
  add column if not exists milestone_title text;

alter table public.conversation_events
  add column if not exists percent_complete integer;

alter table public.conversation_events
  add column if not exists budget numeric(12,2);

alter table public.conversation_events
  add column if not exists notes text;

alter table public.conversation_events
  add column if not exists description text;
