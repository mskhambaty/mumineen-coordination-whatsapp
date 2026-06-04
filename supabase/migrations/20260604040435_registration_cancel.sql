-- Registration cancellation (soft delete): committee can cancel a submitted registration,
-- preserving all family + member data. Reconstructed from the live database.

alter table public.families drop constraint if exists families_registration_status_check;
alter table public.families add constraint families_registration_status_check
  check (registration_status in ('not_started', 'in_progress', 'submitted', 'confirmed', 'cancelled'));

alter table public.families add column if not exists cancelled_at timestamptz;
alter table public.families add column if not exists cancelled_reason text;

comment on column public.families.cancelled_at is 'When a submitted registration was cancelled by the committee (soft delete; row + member data preserved).';
