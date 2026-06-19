-- Per-member RSVP grid for one Niyaz event (the admin event-detail "By Individual" view). The
-- per-person parallel of niyaz_event_family_grid: one row per *eligible-to-RSVP* member, left-joined
-- to niyaz_rsvp so members who never got a row still appear (responded = false → "No response").
-- Without this the By Individual list could only show members who already have a niyaz_rsvp row, so
-- the people who haven't responded — the ones staff most need to chase — were invisible.
--
-- Eligible-to-RSVP population is IDENTICAL to niyaz_event_breakdown (20260617250000): roster-active,
-- attending (not_attending = false), in an active family, and EITHER local OR a mehman whose family
-- registration is submitted. Keeping it identical means the By Individual "No response" count ties
-- out exactly to the Breakdown panel's "Not responded" total.
--
--   attending     = the member's niyaz_rsvp.attending (null when they have no row)
--   source        = how that row got its value (null when no row)
--   responded     = the row is a real confirmation (source in ('whatsapp','admin')), else false
--   responded_by  = phone (or admin) on that row
--   whatsapp      = the member's WhatsApp number for contacting them (CSV export): their own
--                   whatsapp_e164, else their primary mumin_phone_links number — matches the
--                   canonical resolution in src/lib/mumineen/sender-profile.ts
--
-- Ordered by mumin id so the API can page it past PostgREST's 1000-row db-max-rows cap. Pure
-- aggregate-free select — no row cap inside the function.

create or replace function public.niyaz_event_individual_grid(p_instance_id uuid)
returns table (
  mumin_id uuid,
  its text,
  full_name text,
  is_adult boolean,
  local_mehman text,
  hof_its text,
  whatsapp text,
  attending boolean,
  source text,
  responded_by text,
  updated_at timestamptz,
  responded boolean
) as $$
  select
    m.id                                                                              as mumin_id,
    m.its,
    m.full_name,
    m.is_adult,
    m.local_mehman,
    f.hof_its,
    coalesce(
      m.whatsapp_e164,
      (select pl.phone_e164 from public.mumin_phone_links pl
         where pl.mumin_id = m.id order by pl.is_primary desc limit 1)
    )                                                                                 as whatsapp,
    r.attending,
    r.source,
    coalesce(r.responded_by_phone, r.recorded_by)                                     as responded_by,
    r.updated_at,
    coalesce(r.source in ('whatsapp', 'admin'), false)                                as responded
  from public.mumineen m
  join public.families f on f.id = m.family_id
  left join public.niyaz_rsvp r
    on r.mumin_id = m.id and r.registration_instance_id = p_instance_id
  where m.roster_active = true
    and m.not_attending = false
    and f.roster_active = true
    and (coalesce(m.local_mehman, '') <> 'Mehman' or f.registration_status = 'submitted')
  order by m.id;
$$ language sql security invoker stable;
