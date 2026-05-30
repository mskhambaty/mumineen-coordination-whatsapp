-- Add task priorities and archive support for kanban workflows.

alter table public.tasks
  add column if not exists priority text not null default 'medium'
  check (priority in ('low', 'medium', 'high'));

alter table public.tasks
  add column if not exists archived boolean not null default false;

create index if not exists tasks_priority_idx on public.tasks (priority);
create index if not exists tasks_archived_idx on public.tasks (archived);
create index if not exists tasks_dept_status_priority_idx
  on public.tasks (department_id, status, priority desc);
