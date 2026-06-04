-- Per-member travel airport (ORD/MDW), collected during registration.
-- Reconstructed from the live database.

alter table public.mumineen add column if not exists airport text;

comment on column public.mumineen.airport is 'Travel airport chosen during registration (ORD or MDW).';
