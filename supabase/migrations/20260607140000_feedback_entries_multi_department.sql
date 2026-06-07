-- Feedback can legitimately span multiple departments (e.g. "AC broken and parking chaotic").
-- Replace the single department_id FK with a department_ids uuid[] array.
alter table public.feedback_entries add column if not exists department_ids uuid[] not null default '{}';

-- Backfill existing rows from the single column.
update public.feedback_entries
  set department_ids = array[department_id]
  where department_id is not null and department_ids = '{}';

-- Drop the old single column (and its FK + composite index).
drop index if exists feedback_entries_dept_date_idx;
alter table public.feedback_entries drop column if exists department_id;

-- New indexes: date lookups for the digest, GIN for per-department membership.
create index if not exists feedback_entries_event_date_idx on public.feedback_entries (event_date);
create index if not exists feedback_entries_depts_gin on public.feedback_entries using gin (department_ids);
