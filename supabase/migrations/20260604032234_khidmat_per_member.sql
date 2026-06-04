-- Khidmat sign-up is per person, not per family: move the columns from families to mumineen.
-- Reconstructed from the live database.

alter table public.families drop column if exists wants_khidmat;
alter table public.families drop column if exists khidmat_department_ids;

alter table public.mumineen add column if not exists wants_khidmat boolean not null default false;
alter table public.mumineen add column if not exists khidmat_department_ids uuid[] not null default '{}';

comment on column public.mumineen.khidmat_department_ids is 'Departments this member signed up to do khidmat for (max 3), chosen during registration.';
