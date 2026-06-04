-- Per-member "will not be attending" flag, set during registration.
-- Reconstructed from the live database.

alter table public.mumineen add column if not exists not_attending boolean not null default false;

comment on column public.mumineen.not_attending is 'Marked during registration: this roster member will not be attending.';
