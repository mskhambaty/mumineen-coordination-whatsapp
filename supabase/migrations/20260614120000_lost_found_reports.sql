-- Structured lost-and-found reports captured by the WhatsApp agent.

create table public.lost_found_reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('lost', 'found')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  item_name text not null,
  description text,
  category text,
  color text,
  brand text,
  location text,
  occurred_at timestamptz,
  department_id uuid references public.departments(id) on delete set null,
  reporter_user_id uuid references public.whatsapp_users(id) on delete set null,
  reporter_mumin_id uuid references public.mumineen(id) on delete set null,
  reporter_name text,
  reporter_phone_e164 text not null,
  reporter_its text,
  source text not null default 'whatsapp_agent'
    check (source in ('whatsapp_agent', 'manual')),
  escalation_status text not null default 'not_required'
    check (escalation_status in ('not_required', 'pending', 'failed')),
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lost_found_reports enable row level security;

create index lost_found_reports_type_status_created_idx
  on public.lost_found_reports (report_type, status, created_at desc);
create index lost_found_reports_reporter_phone_idx
  on public.lost_found_reports (reporter_phone_e164);
create index lost_found_reports_department_id_idx
  on public.lost_found_reports (department_id);

grant all on table public.lost_found_reports to service_role;

insert into public.departments (name)
select 'Lost and Found'
where not exists (
  select 1
  from public.departments
  where lower(name) in ('lost and found', 'lost & found')
);

create or replace function public.set_lost_found_reports_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lost_found_reports_updated_at
  before update on public.lost_found_reports
  for each row execute function public.set_lost_found_reports_updated_at();
