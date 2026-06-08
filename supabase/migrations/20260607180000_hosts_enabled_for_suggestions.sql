-- Add toggle to enable/disable hosts from the suggestions algorithm.
-- Default is true (enabled). Imports should not touch this column.
alter table public.accommodation_hosts
  add column enabled_for_suggestions boolean not null default true;
