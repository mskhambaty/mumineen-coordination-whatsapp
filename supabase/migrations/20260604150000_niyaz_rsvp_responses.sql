-- Niyaz RSVP — step 2: shape rsvp_responses for per-family, append-only submissions.
-- Each response is tied to a campaign, linked to a family (required), submitted by a specific
-- mumin, and stamped with submitted_at. Multiple adults may submit for one family; the most
-- recent submission (by submitted_at) is the family's effective count. Source + recorded_by
-- track provenance (WhatsApp bot vs admin manual entry). Table was scaffolded empty in
-- 20260603073644_mumineen_roster_registration.sql, so these alters are safe.

-- 1. Responses are always family-linked.
alter table public.rsvp_responses alter column family_id set not null;

-- 2. mumin_id is the submitter — rename for clarity (FK + on delete set null carry over).
alter table public.rsvp_responses rename column mumin_id to submitted_by_mumin_id;

-- 3. When this submission was recorded (app sets now() on each submit/edit).
alter table public.rsvp_responses add column if not exists submitted_at timestamptz not null default now();

-- 4. Provenance.
alter table public.rsvp_responses
  add column if not exists source text not null default 'admin',
  add column if not exists recorded_by text;
alter table public.rsvp_responses drop constraint if exists rsvp_responses_source_check;
alter table public.rsvp_responses add constraint rsvp_responses_source_check check (source in ('whatsapp', 'admin'));

-- 5. Head count sanity.
alter table public.rsvp_responses drop constraint if exists rsvp_responses_head_count_check;
alter table public.rsvp_responses add constraint rsvp_responses_head_count_check check (head_count is null or head_count >= 0);

-- 6. Append-only indexes: allow many submissions per family; keep one (updatable) row per
--    identified submitter; index the latest-per-family lookup.
drop index if exists rsvp_responses_family_uniq;   -- was unique (campaign_id, family_id)
drop index if exists rsvp_responses_member_uniq;   -- was unique (campaign_id, mumin_id)
create unique index rsvp_responses_campaign_submitter_key
  on public.rsvp_responses (campaign_id, submitted_by_mumin_id)
  where submitted_by_mumin_id is not null;
create index rsvp_responses_family_latest_idx
  on public.rsvp_responses (campaign_id, family_id, submitted_at desc);

-- 7. updated_at trigger (column existed without one).
create or replace function public.set_rsvp_responses_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists rsvp_responses_updated_at on public.rsvp_responses;
create trigger rsvp_responses_updated_at
  before update on public.rsvp_responses
  for each row execute function public.set_rsvp_responses_updated_at();
