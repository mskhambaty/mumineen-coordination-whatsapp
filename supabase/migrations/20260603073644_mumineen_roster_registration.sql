-- Mumineen roster + registration + RSVP/feedback core schema.
-- Reconstructed from the live database (was originally applied via the Supabase MCP).
-- Roster identity (import-owned) and registration-collected data share natural keys
-- (mumineen.its, families.hof_its) so re-importing the Excel never clobbers collected data.

create table public.families (
  id uuid primary key default gen_random_uuid(),
  hof_its text not null unique,
  head_in_roster boolean not null default false,
  head_mumin_id uuid,
  roster_active boolean not null default true,
  registration_status text not null default 'not_started'
    check (registration_status in ('not_started', 'in_progress', 'submitted', 'confirmed')),
  submitted_at timestamptz,
  submitted_by_its text,
  acc_type text check (acc_type in ('hotel', 'utaro')),
  hotel_name text,
  hotel_address text,
  utaro_host_name text,
  utaro_host_its text,
  utaro_host_address text,
  utaro_host_whatsapp_e164 text,
  utaro_host_email text,
  transport_mode text check (transport_mode in ('rideshare', 'rental', 'commute_with_utaro', 'other')),
  transport_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mumineen (
  id uuid primary key default gen_random_uuid(),
  its text not null unique,
  family_id uuid references public.families(id) on delete cascade,
  hof_its text not null,
  is_head boolean not null default false,
  whatsapp_user_id uuid references public.whatsapp_users(id) on delete set null,
  roster_active boolean not null default true,
  -- Import-owned columns (refreshed by the Excel re-import).
  full_name text,
  gender text check (gender in ('M', 'F')),
  age integer,
  is_adult boolean generated always as (age >= 18) stored,
  jamaat text,
  idara text,
  category text,
  prefix text,
  title text,
  venue text,
  city text,
  local_mehman text,
  roster_arrival_raw text,
  roster_flight_code text,
  daily_trans text,
  whatsapp_link_clicked boolean,
  -- Registration-collected columns (filled by the public form; import never updates these).
  whatsapp_e164 text,
  email text,
  arrival_at timestamptz,
  arrival_flight_no text,
  departure_at timestamptz,
  departure_flight_no text,
  rahat_seating boolean not null default false,
  wheelchair boolean not null default false,
  special_needs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- families.head_mumin_id references mumineen, so add it after mumineen exists (circular FK).
alter table public.families
  add constraint families_head_mumin_id_fkey foreign key (head_mumin_id) references public.mumineen(id) on delete set null;

create index mumineen_family_id_idx on public.mumineen (family_id);
create index mumineen_hof_its_idx on public.mumineen (hof_its);
create index mumineen_is_adult_idx on public.mumineen (is_adult);
create index mumineen_whatsapp_e164_idx on public.mumineen (whatsapp_e164);

-- Phone -> roster bridge (one phone may map to many members; shared numbers allowed).
create table public.mumin_phone_links (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  mumin_id uuid not null references public.mumineen(id) on delete cascade,
  source text not null default 'registration' check (source in ('registration', 'manual', 'inferred')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (phone_e164, mumin_id)
);
create index mumin_phone_links_phone_idx on public.mumin_phone_links (phone_e164);
create index mumin_phone_links_mumin_idx on public.mumin_phone_links (mumin_id);

-- RSVP/feedback (designed now, used later).
create table public.rsvp_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  kind text not null default 'generic' check (kind in ('food', 'event', 'generic')),
  dedup_scope text not null default 'family' check (dedup_scope in ('family', 'member')),
  target_filter jsonb not null default '{}'::jsonb,
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rsvp_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.rsvp_campaigns(id) on delete cascade,
  family_id uuid references public.families(id) on delete cascade,
  mumin_id uuid references public.mumineen(id) on delete set null,
  response text check (response in ('yes', 'no', 'maybe')),
  head_count integer,
  responded_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Family-scope campaigns count a family once; member-scope count a member once.
create unique index rsvp_responses_family_uniq on public.rsvp_responses (campaign_id, family_id) where (family_id is not null);
create unique index rsvp_responses_member_uniq on public.rsvp_responses (campaign_id, mumin_id) where (mumin_id is not null);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.rsvp_campaigns(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  mumin_id uuid references public.mumineen(id) on delete set null,
  phone_e164 text,
  rating integer check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now()
);

-- RLS enabled; the app authorizes at the service-role layer (consistent with the rest of the schema).
alter table public.families enable row level security;
alter table public.mumineen enable row level security;
alter table public.mumin_phone_links enable row level security;
alter table public.rsvp_campaigns enable row level security;
alter table public.rsvp_responses enable row level security;
alter table public.feedback enable row level security;
