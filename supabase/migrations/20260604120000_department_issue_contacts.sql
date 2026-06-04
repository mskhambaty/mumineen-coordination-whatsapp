-- Department issue contacts: per-user, per-department notification flag.

alter table public.department_members
  add column if not exists contact_for_issues boolean not null default false;

create index if not exists department_members_issue_contacts_idx
  on public.department_members (department_id)
  where is_active = true and contact_for_issues = true;
