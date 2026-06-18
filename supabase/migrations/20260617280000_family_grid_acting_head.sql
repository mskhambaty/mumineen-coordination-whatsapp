-- Align niyaz_event_family_grid's hof_name to the same "acting head" rule the mumin lookup uses
-- (src/app/api/admin/mumineen/search/route.ts): the family's head is the is_head member if present,
-- otherwise the eldest member (age desc). This replaces the earlier its=hof_its / lowest-ITS-adult
-- fallback so the By Family grid shows the exact same person the roster lookup badges as "Acting head".
-- Guests (sentinel ITS) and inactive members are excluded; falls back to hof_its only if a family has
-- no roster-active real member at all.

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
    coalesce(ah.full_name, f.hof_its)                                                 as hof_name,
    coalesce(bool_or(r.source in ('whatsapp', 'admin')), false)                       as responded,
    count(*) filter (where r.attending and m.its not like '00000%')                   as attending,
    count(*) filter (where r.attending and m.its like '00000%')                       as guests,
    max(r.updated_at) filter (where r.source in ('whatsapp', 'admin'))                as responded_at,
    (array_agg(coalesce(r.responded_by_phone, r.recorded_by) order by r.updated_at desc)
       filter (where r.source in ('whatsapp', 'admin')))[1]                           as responded_by
  from public.families f
  -- The family's acting head: is_head member if present, else the eldest member (matches the lookup).
  left join lateral (
    select m2.full_name
    from public.mumineen m2
    where m2.family_id = f.id and m2.its not like '00000%' and m2.roster_active = true
    order by m2.is_head desc, m2.age desc, m2.its asc
    limit 1
  ) ah on true
  left join public.niyaz_rsvp r
    on r.family_id = f.id and r.registration_instance_id = p_instance_id
  left join public.mumineen m on m.id = r.mumin_id
  where f.roster_active = true
  group by f.id, f.hof_its, ah.full_name
  order by f.id;
$$ language sql security invoker stable;
