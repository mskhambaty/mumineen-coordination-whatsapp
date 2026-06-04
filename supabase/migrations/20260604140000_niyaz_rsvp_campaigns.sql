-- Niyaz RSVP — step 1: flesh out rsvp_campaigns with the event details we collect RSVPs against.
-- The table was scaffolded generic + empty in 20260603073644_mumineen_roster_registration.sql;
-- here we add the when/where/description + an explicit lifecycle status, and type 'niyaz'.

alter table public.rsvp_campaigns
  add column if not exists event_at timestamptz,
  add column if not exists venue_name text,
  add column if not exists venue_address text,
  add column if not exists description text,
  add column if not exists status text not null default 'draft';

-- Lifecycle the committee controls; 'open' is the campaign currently collecting responses.
alter table public.rsvp_campaigns
  drop constraint if exists rsvp_campaigns_status_check;
alter table public.rsvp_campaigns
  add constraint rsvp_campaigns_status_check check (status in ('draft', 'open', 'closed'));

-- Allow 'niyaz' as a campaign kind alongside the existing generic types.
alter table public.rsvp_campaigns
  drop constraint if exists rsvp_campaigns_kind_check;
alter table public.rsvp_campaigns
  add constraint rsvp_campaigns_kind_check check (kind in ('food', 'event', 'generic', 'niyaz'));

-- updated_at trigger (the column existed without one).
create or replace function public.set_rsvp_campaigns_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists rsvp_campaigns_updated_at on public.rsvp_campaigns;
create trigger rsvp_campaigns_updated_at
  before update on public.rsvp_campaigns
  for each row execute function public.set_rsvp_campaigns_updated_at();
