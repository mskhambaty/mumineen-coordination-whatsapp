-- Add department-level transcript prompt configuration and richer parsed event review fields.

create table if not exists public.department_prompt_config (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade unique,
  flexible_prompt text not null default '',
  updated_by uuid references public.whatsapp_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.department_prompt_config enable row level security;

create index if not exists department_prompt_config_department_id_idx
  on public.department_prompt_config (department_id);

create or replace function public.set_department_prompt_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists department_prompt_config_updated_at on public.department_prompt_config;

create trigger department_prompt_config_updated_at
  before update on public.department_prompt_config
  for each row execute function public.set_department_prompt_config_updated_at();

alter table public.conversation_uploads
  add column if not exists parsed_new_members jsonb not null default '[]'::jsonb;

alter table public.conversation_events
  add column if not exists task_title text,
  add column if not exists assigned_to_alias text,
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high'));

create index if not exists conversation_events_priority_idx
  on public.conversation_events (priority);
