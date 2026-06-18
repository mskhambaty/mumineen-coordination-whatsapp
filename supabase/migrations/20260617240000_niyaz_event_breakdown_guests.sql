-- Redefine niyaz_event_breakdown to split synthetic guests into their own group instead of letting
-- them pollute the Local column. Registration overflow creates placeholder "guest" mumineen (sentinel
-- ITS '00000-…', full_name 'Guest', no local_mehman) that still belong in the headline/Thaals (real
-- mouths to feed) but are NOT real members — so the Local/Mehmaan member KPIs must exclude them.
--
-- Group is now a 3-way text classifier instead of the is_mehman boolean:
--   'guest'  -> its like '00000%' (synthetic overflow placeholder)
--   'mehman' -> real member with local_mehman = 'Mehman'
--   'local'  -> any other real member (includes roster-inactive real members with a real ITS)
-- local + mehman + guest still covers every niyaz_rsvp row, so Total reconciles with the headline.

drop function if exists public.niyaz_event_breakdown(uuid);

create function public.niyaz_event_breakdown(p_instance_id uuid)
returns table (
  grp text,
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
    case
      when m.its like '00000%' then 'guest'
      when coalesce(m.local_mehman, '') = 'Mehman' then 'mehman'
      else 'local'
    end                                                                                                as grp,
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
