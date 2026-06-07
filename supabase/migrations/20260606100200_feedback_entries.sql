-- Append-only feedback captured from the daily "how did today go?" flow (and any chat where a
-- visitor volunteers feedback). One row per area mentioned; tagged to the owning department so the
-- nightly per-department digest is a simple filter. Never overwritten — sentiment/trends come from
-- the full event stream.

create table if not exists public.feedback_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete set null,
  mumin_id uuid references public.mumineen(id) on delete set null,
  phone_e164 text,
  area text not null check (area in (
    'mawaid', 'flow', 'parking_transport', 'audio_video',
    'accommodation', 'seating', 'general'
  )),
  department_id uuid references public.departments(id) on delete set null,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  rating integer check (rating is null or (rating >= 1 and rating <= 5)),
  comment_text text,
  raw_message text,
  event_date date,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'admin')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_entries_dept_date_idx
  on public.feedback_entries (department_id, event_date);
create index if not exists feedback_entries_area_date_idx
  on public.feedback_entries (area, event_date);
create index if not exists feedback_entries_family_idx
  on public.feedback_entries (family_id);

alter table public.feedback_entries enable row level security;
