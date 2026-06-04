-- Accommodation extras: "open to Utaro" interest flag + hotel map pin coordinates.
-- Reconstructed from the live database.

alter table public.families add column if not exists open_to_utaro boolean not null default false;
alter table public.families add column if not exists hotel_lat double precision;
alter table public.families add column if not exists hotel_lon double precision;

comment on column public.families.open_to_utaro is 'Hotel-staying family is open to Utaro if a host becomes available (interest flag only).';
