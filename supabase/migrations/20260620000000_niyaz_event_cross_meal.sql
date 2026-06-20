-- Cross-meal "yes here / no there" list for the niyaz event-detail page. A day has up to two meal
-- events (lunch + dinner, same event_date). This returns the mumineen attending THIS meal but NOT the
-- day's other meal — e.g. on a lunch event, those who said yes to lunch but no to dinner — so staff
-- can plan per meal and follow up. One row per matching mumin (count = row count), same shape as
-- niyaz_event_individual_grid so the page reuses its rendering + CSV export.
--
-- p_confirmed_only mirrors the page's Min/Max toggle: true (Min) counts only confirmed RSVPs
-- (source in ('whatsapp','admin'), like niyaz_event_tallies_min); false (Max) takes niyaz_rsvp.attending
-- at face value for every row. The day's sibling instance is the same event_date with the other meal
-- (unique via the (event_date, meal) index); when the day has no sibling meal the function returns no
-- rows. Pure select, ordered by mumin id so the API can page it past the 1000-row cap.

create or replace function public.niyaz_event_cross_meal(p_instance_id uuid, p_confirmed_only boolean)
returns table (
  mumin_id uuid,
  its text,
  full_name text,
  is_adult boolean,
  local_mehman text,
  hof_its text,
  whatsapp text
) as $$
  with me as (
    select event_date, meal from public.rsvp_registration_instance where id = p_instance_id
  ),
  sib as (
    select s.id
    from public.rsvp_registration_instance s
    join me on s.event_date = me.event_date
    where s.meal is not null and s.meal is distinct from me.meal
    order by s.id
    limit 1
  )
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
    )                                                                                 as whatsapp
  from sib
  join public.niyaz_rsvp here
    on here.registration_instance_id = p_instance_id
    and here.attending = true
    and (not p_confirmed_only or here.source in ('whatsapp', 'admin'))
  join public.niyaz_rsvp there
    on there.registration_instance_id = sib.id
    and there.mumin_id = here.mumin_id
    and there.attending = false
    and (not p_confirmed_only or there.source in ('whatsapp', 'admin'))
  join public.mumineen m on m.id = here.mumin_id
  left join public.families f on f.id = m.family_id
  order by m.id;
$$ language sql security invoker stable;
