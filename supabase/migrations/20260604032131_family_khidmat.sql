-- First pass: family-level khidmat sign-up. Superseded by 20260604032234_khidmat_per_member.sql,
-- which moves these columns onto mumineen (khidmat is per person). Reconstructed from the live database.

alter table public.families add column if not exists wants_khidmat boolean not null default false;
alter table public.families add column if not exists khidmat_department_ids uuid[] not null default '{}';

comment on column public.families.khidmat_department_ids is 'Departments the family signed up to do khidmat for (max 3), chosen during registration.';
