-- Multi-department transcript uploads and OpenAI function-call audit trail.

create table if not exists public.conversation_upload_departments (
  upload_id uuid not null references public.conversation_uploads(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (upload_id, department_id)
);

alter table public.conversation_upload_departments enable row level security;

create index if not exists conversation_upload_departments_department_id_idx
  on public.conversation_upload_departments (department_id);

create table if not exists public.transcript_function_calls (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.conversation_uploads(id) on delete cascade,
  department_ids uuid[] not null default '{}'::uuid[],
  transcript_type text not null default 'whatsapp'
    check (transcript_type in ('whatsapp', 'meeting')),
  function_name text not null,
  model text,
  request_prompt text,
  request_context jsonb not null default '{}'::jsonb,
  raw_response jsonb,
  arguments jsonb,
  parse_error text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.transcript_function_calls enable row level security;

create index if not exists transcript_function_calls_upload_id_idx
  on public.transcript_function_calls (upload_id);

create index if not exists transcript_function_calls_status_idx
  on public.transcript_function_calls (status);

alter table public.conversation_events
  add column if not exists function_call_id uuid references public.transcript_function_calls(id) on delete set null,
  add column if not exists raw_function_event jsonb,
  add column if not exists suggested_changes jsonb,
  add column if not exists suggested_status text
    check (suggested_status is null or suggested_status in ('open', 'in_progress', 'blocked', 'complete')),
  add column if not exists due_date date,
  add column if not exists assigned_to_user_id uuid references public.whatsapp_users(id) on delete set null,
  add column if not exists source text;

create index if not exists conversation_events_function_call_id_idx
  on public.conversation_events (function_call_id);

create index if not exists conversation_events_suggested_status_idx
  on public.conversation_events (suggested_status);
