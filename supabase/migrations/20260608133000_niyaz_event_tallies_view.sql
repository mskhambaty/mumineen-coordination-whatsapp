-- Per-event attendance tallies for the admin Niyaz page: yes/no counts split by adult/kid and by
-- family, plus the thaal count (ceil of attending heads / 8). is_adult NULL counts as an adult.
-- security_invoker so the view respects the underlying tables' RLS (app reads it via service role).

create or replace view public.niyaz_event_tallies
with (security_invoker = on) as
select
  i.id as instance_id,
  count(*) filter (where r.attending and coalesce(m.is_adult, true))        as yes_adults,
  count(*) filter (where r.attending and m.is_adult = false)                as yes_kids,
  count(distinct r.family_id) filter (where r.attending)                    as yes_families,
  ceil((count(*) filter (where r.attending))::numeric / 8)                  as thaal_count,
  count(*) filter (where (not r.attending) and coalesce(m.is_adult, true))  as no_adults,
  count(*) filter (where (not r.attending) and m.is_adult = false)          as no_kids,
  count(distinct r.family_id) filter (where not r.attending)                as no_families
from public.rsvp_registration_instance i
left join public.niyaz_rsvp r on r.registration_instance_id = i.id
left join public.mumineen m on m.id = r.mumin_id
group by i.id;
