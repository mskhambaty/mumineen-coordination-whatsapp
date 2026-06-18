-- Local-vs-Mehmaan breakdown for one Niyaz event, aggregated in the DB so it is correct regardless
-- of row count. The per-mumin niyaz_rsvp list returned to the admin page is capped by PostgREST's
-- db-max-rows (1000), so the event-detail "Breakdown" panel must NOT be computed from that list — it
-- reads this aggregate instead, exactly as the headline Yes/No tally already does.
--
-- One row per local/mehman group present (is_mehman = local_mehman = 'Mehman'; null/anything else is
-- treated as local, matching the client classifier). Mirrors the two tally modes:
--   *_min counts only active confirmations (source in whatsapp/admin)
--   *_max counts every row (arrival-date seeded defaults included)
-- responded/not_responded is source-based and therefore mode-independent.
-- is_adult is null for adults (roster convention), so adult buckets use coalesce(is_adult, true).

create or replace function public.niyaz_event_breakdown(p_instance_id uuid)
returns table (
  is_mehman boolean,
  yes_min bigint,
  no_min bigint,
  yes_adults_min bigint,
  yes_kids_min bigint,
  no_adults_min bigint,
  no_kids_min bigint,
  yes_max bigint,
  no_max bigint,
  yes_adults_max bigint,
  yes_kids_max bigint,
  no_adults_max bigint,
  no_kids_max bigint,
  responded bigint,
  not_responded bigint
) as $$
  select
    (coalesce(m.local_mehman, '') = 'Mehman')                                                            as is_mehman,
    count(*) filter (where r.attending and r.source in ('whatsapp','admin'))                             as yes_min,
    count(*) filter (where (not r.attending) and r.source in ('whatsapp','admin'))                       as no_min,
    count(*) filter (where r.attending and r.source in ('whatsapp','admin') and coalesce(m.is_adult,true)) as yes_adults_min,
    count(*) filter (where r.attending and r.source in ('whatsapp','admin') and m.is_adult = false)      as yes_kids_min,
    count(*) filter (where (not r.attending) and r.source in ('whatsapp','admin') and coalesce(m.is_adult,true)) as no_adults_min,
    count(*) filter (where (not r.attending) and r.source in ('whatsapp','admin') and m.is_adult = false) as no_kids_min,
    count(*) filter (where r.attending)                                                                  as yes_max,
    count(*) filter (where not r.attending)                                                              as no_max,
    count(*) filter (where r.attending and coalesce(m.is_adult,true))                                    as yes_adults_max,
    count(*) filter (where r.attending and m.is_adult = false)                                           as yes_kids_max,
    count(*) filter (where (not r.attending) and coalesce(m.is_adult,true))                              as no_adults_max,
    count(*) filter (where (not r.attending) and m.is_adult = false)                                     as no_kids_max,
    count(*) filter (where r.source in ('whatsapp','admin'))                                             as responded,
    count(*) filter (where r.source not in ('whatsapp','admin'))                                         as not_responded
  from public.niyaz_rsvp r
  left join public.mumineen m on m.id = r.mumin_id
  where r.registration_instance_id = p_instance_id
  group by 1;
$$ language sql security invoker stable;
