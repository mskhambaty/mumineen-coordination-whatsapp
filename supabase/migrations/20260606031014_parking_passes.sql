-- Parking pass management (transport team tool).
-- Lots are fixed (seeded here); capacity/color/purposes are edited in the admin UI.
-- One parking_passes row = one physical pass; a household may hold passes in
-- multiple lots. Revoke = hard delete (planning churn; no audit requirement).

create table public.parking_lots (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  capacity integer not null default 0,
  -- Plain text by design: 8 suggested colors today, a 9th may appear; duplicates across lots allowed.
  color text,
  -- Subset of: vip, ada, foreign_mehman, all_65_plus, chicago, early_khidmat (app-validated).
  -- ('vip_incapacitated' was split into 'vip' + 'ada' in 20260607140000_split_parking_vip_ada_purpose.sql.)
  purposes text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.parking_passes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  lot_id uuid not null references public.parking_lots(id) on delete cascade,
  -- Internal portal user who assigned the pass (registration's submitted_by_its is the
  -- member's ITS because that flow is self-service; this one is internal-only).
  assigned_by uuid references public.whatsapp_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index parking_passes_family_id_idx on public.parking_passes (family_id);
create index parking_passes_lot_id_idx on public.parking_passes (lot_id);

-- RLS enabled; the app authorizes at the service-role layer (consistent with the rest of the schema).
alter table public.parking_lots enable row level security;
alter table public.parking_passes enable row level security;

-- The 9 lots. Capacity 0 until the transport team sets real values in the UI.
insert into public.parking_lots (name, sort_order) values
  ('Masjid', 1),
  ('Buddha', 2),
  ('Macedonian', 3),
  ('Father Tony', 4),
  ('Mecca Center', 5),
  ('Ezzy', 6),
  ('Burr Ridge', 7),
  ('Pizza Track', 8),
  ('Anne Jeans', 9);
