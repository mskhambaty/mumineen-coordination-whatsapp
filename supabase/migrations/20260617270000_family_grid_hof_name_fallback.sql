-- Improve HOF name resolution in niyaz_event_family_grid. ~215 roster-active families have no head
-- mumin row (the head's own ITS isn't in the roster — common for mehman families whose members carry
-- sequential ITS numbers), so hof_name fell back to the bare hof_its and the UI showed the ITS twice.
-- All such families DO have named real members, so fall back to a representative member's name
-- (prefer an adult, then lowest ITS for stability) before the hof_its string.

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
    coalesce(h.full_name, rep.full_name, f.hof_its)                                   as hof_name,
    coalesce(bool_or(r.source in ('whatsapp', 'admin')), false)                       as responded,
    count(*) filter (where r.attending and m.its not like '00000%')                   as attending,
    count(*) filter (where r.attending and m.its like '00000%')                       as guests,
    max(r.updated_at) filter (where r.source in ('whatsapp', 'admin'))                as responded_at,
    (array_agg(coalesce(r.responded_by_phone, r.recorded_by) order by r.updated_at desc)
       filter (where r.source in ('whatsapp', 'admin')))[1]                           as responded_by
  from public.families f
  -- The head's own mumin row, if present (its = hof_its).
  left join public.mumineen h on h.its = f.hof_its
  -- Otherwise a representative real member: prefer an adult, then the lowest ITS for a stable pick.
  left join lateral (
    select m2.full_name
    from public.mumineen m2
    where m2.family_id = f.id and m2.its not like '00000%' and m2.roster_active = true
    order by (m2.is_adult is not false) desc, m2.its asc
    limit 1
  ) rep on true
  left join public.niyaz_rsvp r
    on r.family_id = f.id and r.registration_instance_id = p_instance_id
  left join public.mumineen m on m.id = r.mumin_id
  where f.roster_active = true
  group by f.id, f.hof_its, h.full_name, rep.full_name
  order by f.id;
$$ language sql security invoker stable;
