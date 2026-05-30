-- System prompts table for editable AI prompts via the admin dashboard.

create table if not exists public.system_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null unique,
  prompt_text text not null,
  updated_by uuid references public.whatsapp_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.system_prompts enable row level security;

create or replace function public.set_system_prompts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger system_prompts_updated_at
  before update on public.system_prompts
  for each row execute function public.set_system_prompts_updated_at();
