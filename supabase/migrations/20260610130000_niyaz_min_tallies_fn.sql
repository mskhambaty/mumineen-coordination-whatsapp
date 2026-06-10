-- Min-mode event tallies: same aggregation as niyaz_event_tallies but only counts RSVPs
-- from active confirmations (source = 'whatsapp' or 'admin'), excluding the default
-- arrival-date seeded rows. Used for the "Min" tab on the admin Niyaz page.

create or replace function public.niyaz_event_tallies_min()
returns table (
  instance_id uuid,
  yes_adults bigint,
  yes_kids bigint,
  yes_families bigint,
  thaal_count numeric,
  no_adults bigint,
  no_kids bigint,
  no_families bigint
) as $$
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
  left join public.niyaz_rsvp r
    on r.registration_instance_id = i.id
    and r.source in ('whatsapp', 'admin')
  left join public.mumineen m on m.id = r.mumin_id
  group by i.id;
$$ language sql security invoker;
