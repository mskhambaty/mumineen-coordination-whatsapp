-- Accommodations matching module: host imports, hosts, and guest-host matches.

-- Raw import history (one row per spreadsheet upload, preserving the raw JSON).
create table public.accommodation_host_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  filename text,
  row_count integer not null default 0,
  raw_json jsonb not null default '[]'::jsonb
);

alter table public.accommodation_host_imports enable row level security;

-- Normalized hosts derived from the latest import (upserted on hof_its).
create table public.accommodation_hosts (
  id uuid primary key default gen_random_uuid(),
  hof_its text not null unique,
  first_name text,
  middle_name text,
  last_name text,
  poc text,
  status text,
  mobile text,
  address text,
  city text,
  pincode text,
  lat double precision,
  lon double precision,
  geocoded_at timestamptz,
  geocode_source text,
  can_provide_utaro boolean not null default false,
  capacity_mehman integer not null default 0,
  bedrooms_mehman integer,
  bathrooms_mehman integer,
  capacity_family_friends integer not null default 0,
  include_family_friends boolean not null default false,
  sahebo_preference text,
  gender_preference text,
  days_after_ashura integer,
  pet_type text,
  number_allocated integer not null default 0,
  import_id uuid references public.accommodation_host_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accommodation_hosts enable row level security;

create index accommodation_hosts_can_provide_idx
  on public.accommodation_hosts (can_provide_utaro) where can_provide_utaro = true;

-- Guest-host match linkage with lifecycle status.
create table public.accommodation_matches (
  id uuid primary key default gen_random_uuid(),
  guest_family_id uuid not null references public.families(id) on delete cascade,
  host_id uuid not null references public.accommodation_hosts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  guest_member_count integer not null default 1,
  notes text,
  -- Audit: previous guest family accommodation fields before confirm overwrote them.
  previous_acc_type text,
  previous_utaro_host_name text,
  previous_utaro_host_its text,
  previous_utaro_host_address text,
  confirmed_at timestamptz,
  confirmed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_family_id, host_id)
);

alter table public.accommodation_matches enable row level security;

create index accommodation_matches_host_idx on public.accommodation_matches (host_id);
create index accommodation_matches_status_idx on public.accommodation_matches (status);

-- RLS policies: admin-only access via service role (API routes use getSupabaseAdmin).
create policy "Service role full access" on public.accommodation_host_imports
  for all using (true) with check (true);

create policy "Service role full access" on public.accommodation_hosts
  for all using (true) with check (true);

create policy "Service role full access" on public.accommodation_matches
  for all using (true) with check (true);
