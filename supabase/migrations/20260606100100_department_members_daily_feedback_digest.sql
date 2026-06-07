-- Per-member opt-OUT toggle for the nightly department feedback digest. Mirrors
-- contact_for_issues, but defaults ON (members receive the digest unless they turn it off).

alter table public.department_members
  add column if not exists daily_feedback_digest boolean not null default true;

create index if not exists department_members_feedback_digest_idx
  on public.department_members (department_id)
  where is_active = true and daily_feedback_digest = true;
