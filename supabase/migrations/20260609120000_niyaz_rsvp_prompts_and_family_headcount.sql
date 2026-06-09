-- Free-text family head-count RSVP. Two tables:
-- 1. niyaz_rsvp_prompts — links a free-text numeric reply back to a date. Written per recipient when
--    the admin sends the family head-count template; the next numeric reply from that phone consumes
--    the most recent open prompt so we know which day the count is for.
-- 2. niyaz_family_headcount — the per-(event, family) head count itself (one number = whole-day total,
--    applied to each of that day's events).

create table if not exists public.niyaz_rsvp_prompts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  family_id uuid references public.families(id) on delete cascade,
  event_date date not null,
  sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists niyaz_rsvp_prompts_phone_open_idx
  on public.niyaz_rsvp_prompts (phone_e164, sent_at desc) where consumed_at is null;
alter table public.niyaz_rsvp_prompts enable row level security;

create table if not exists public.niyaz_family_headcount (
  id uuid primary key default gen_random_uuid(),
  registration_instance_id uuid not null references public.rsvp_registration_instance(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  head_count integer not null default 0,
  source text not null default 'whatsapp',
  responded_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint niyaz_family_headcount_key unique (registration_instance_id, family_id),
  constraint niyaz_family_headcount_count_check check (head_count >= 0)
);
create index if not exists niyaz_family_headcount_family_idx on public.niyaz_family_headcount (family_id);
alter table public.niyaz_family_headcount enable row level security;

create or replace function public.set_niyaz_family_headcount_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists niyaz_family_headcount_updated_at on public.niyaz_family_headcount;
create trigger niyaz_family_headcount_updated_at
  before update on public.niyaz_family_headcount
  for each row execute function public.set_niyaz_family_headcount_updated_at();
