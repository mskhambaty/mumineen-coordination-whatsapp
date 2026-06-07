-- Durable, browsable nightly briefings. One row per department per day; the all-up leadership
-- view uses department_id = null. metrics holds the aggregated counts (questions/issues/
-- escalations/feedback/RSVP totals); ai_briefing is the generated narrative.

create table if not exists public.department_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade,
  summary_date date not null,
  metrics jsonb not null default '{}'::jsonb,
  ai_briefing text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (department, day); the all-up row (department_id null) is unique per day too.
create unique index if not exists department_daily_summaries_dept_day_key
  on public.department_daily_summaries (department_id, summary_date)
  where department_id is not null;
create unique index if not exists department_daily_summaries_allup_day_key
  on public.department_daily_summaries (summary_date)
  where department_id is null;

alter table public.department_daily_summaries enable row level security;

create or replace function public.set_department_daily_summaries_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists department_daily_summaries_updated_at on public.department_daily_summaries;
create trigger department_daily_summaries_updated_at
  before update on public.department_daily_summaries
  for each row execute function public.set_department_daily_summaries_updated_at();
