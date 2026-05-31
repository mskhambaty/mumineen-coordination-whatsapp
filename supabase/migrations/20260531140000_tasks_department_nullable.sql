-- External issues (raised from the inbox via create_issue) have no department until
-- an admin triages them, so department_id must be nullable.
alter table public.tasks alter column department_id drop not null;
