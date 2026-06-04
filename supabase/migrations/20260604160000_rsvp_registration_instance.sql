-- Rename the generic rsvp_campaigns scaffold into a purpose-built Niyaz registration-instance
-- table, and trim the generic columns we don't use. Also rename the response FK column to match.

-- 1. Table rename (RLS, trigger, and the feedback FK follow automatically).
alter table public.rsvp_campaigns rename to rsvp_registration_instance;

-- 2. Trim generic scaffolding columns (kind/dedup_scope/target_filter/slug) — every row here is a
--    family-scoped Niyaz instance, so they're redundant.
alter table public.rsvp_registration_instance drop constraint if exists rsvp_campaigns_kind_check;
alter table public.rsvp_registration_instance drop column if exists kind;
alter table public.rsvp_registration_instance drop column if exists dedup_scope;
alter table public.rsvp_registration_instance drop column if exists target_filter;
alter table public.rsvp_registration_instance drop column if exists slug;

-- 3. Tidy the status constraint + updated_at trigger names to match the new table.
alter table public.rsvp_registration_instance rename constraint rsvp_campaigns_status_check to rsvp_registration_instance_status_check;

drop trigger if exists rsvp_campaigns_updated_at on public.rsvp_registration_instance;
create or replace function public.set_rsvp_registration_instance_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create trigger rsvp_registration_instance_updated_at
  before update on public.rsvp_registration_instance
  for each row execute function public.set_rsvp_registration_instance_updated_at();
drop function if exists public.set_rsvp_campaigns_updated_at();

-- 4. Rename the response FK column campaign_id -> registration_instance_id and rebuild its indexes.
alter table public.rsvp_responses rename column campaign_id to registration_instance_id;

drop index if exists rsvp_responses_family_latest_idx;
create index rsvp_responses_family_latest_idx
  on public.rsvp_responses (registration_instance_id, family_id, submitted_at desc);

drop index if exists rsvp_responses_campaign_submitter_key;
create unique index rsvp_responses_instance_submitter_key
  on public.rsvp_responses (registration_instance_id, submitted_by_mumin_id)
  where submitted_by_mumin_id is not null;
