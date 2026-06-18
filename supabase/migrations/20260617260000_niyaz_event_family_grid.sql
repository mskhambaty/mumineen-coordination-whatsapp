-- Per-family RSVP grid for one Niyaz event (the admin event-detail "By Family" view). One row per
-- roster-active family with whether they responded, the attending headcount they gave, a guest count,
-- and when/by whom — all derived from niyaz_rsvp (the niyaz_family_headcount audit table is often
-- empty, so it is NOT the source of truth here).
--
--   responded     = any whatsapp/admin row for the family this event
--   attending     = attending real members (sentinel-ITS guests excluded)
--   guests        = attending guest placeholders (its like '00000%')
--   responded_at  = latest update among the family's whatsapp/admin rows
--   responded_by  = phone (or admin) on that latest confirmed row
--
-- HOF name resolves via mumineen.its = families.hof_its (the head's own ITS); families whose head is
-- not in the roster fall back to the hof_its string. Ordered by family_id so the API can page it past
-- PostgREST's 1000-row db-max-rows cap. Pure aggregate — no row cap inside the function.

create or replace function public.niyaz_event_family_grid(p_instance_id uuid)
returns table (
  family_id uuid,
  hof_its text,
  hof_name text,
  responded boolean,
  attending bigint,
  guests bigint,
  responded_at timestamptz,
  responded_by text
) as $$
  select
    f.id                                                                              as family_id,
    f.hof_its,
    coalesce(h.full_name, f.hof_its)                                                  as hof_name,
    coalesce(bool_or(r.source in ('whatsapp', 'admin')), false)                       as responded,
    count(*) filter (where r.attending and m.its not like '00000%')                   as attending,
    count(*) filter (where r.attending and m.its like '00000%')                       as guests,
    max(r.updated_at) filter (where r.source in ('whatsapp', 'admin'))                as responded_at,
    (array_agg(coalesce(r.responded_by_phone, r.recorded_by) order by r.updated_at desc)
       filter (where r.source in ('whatsapp', 'admin')))[1]                           as responded_by
  from public.families f
  left join public.mumineen h on h.its = f.hof_its
  left join public.niyaz_rsvp r
    on r.family_id = f.id and r.registration_instance_id = p_instance_id
  left join public.mumineen m on m.id = r.mumin_id
  where f.roster_active = true
  group by f.id, f.hof_its, h.full_name
  order by f.id;
$$ language sql security invoker stable;
