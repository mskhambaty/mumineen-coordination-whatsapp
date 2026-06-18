-- Redefine niyaz_event_breakdown around the "eligible to RSVP" population instead of counting every
-- niyaz_rsvp row. The event-detail Breakdown table answers "of the members who should RSVP, who said
-- yes/no and who hasn't responded".
--
-- Eligible to RSVP (matches the all_adults/all_hof audience rule in niyaz-prompt.ts): roster-active,
-- attending (not_attending = false), in an active family, and EITHER local OR a mehman whose family
-- registration is submitted. Split Local vs Mehmaan.
--
--   yes  = attending and source in ('whatsapp','admin')   (confirmation-based)
--   no   = not attending and source in ('whatsapp','admin')
--   responded     = source in ('whatsapp','admin')  (= yes + no)
--   not_responded = eligible but NOT responded — the COMPLEMENT, so it also captures 'default',
--                   'roster', 'registration' and eligible members with no row at all (a literal
--                   source='default' would miss the large 'roster' bucket and the no-row members).
--
-- Guests are NOT eligible members (roster_active = false). They get their own group from the
-- sentinel-ITS placeholders that RSVP'd yes (still counted in the headline/Thaals, kept out of the
-- member totals here). Pure DB aggregate => no PostgREST 1000-row cap anywhere.

drop function if exists public.niyaz_event_breakdown(uuid);

create function public.niyaz_event_breakdown(p_instance_id uuid)
returns table (
  grp text,
  eligible bigint,
  yes bigint,
  no bigint,
  yes_adults bigint,
  yes_kids bigint,
  no_adults bigint,
  no_kids bigint,
  responded bigint,
  not_responded bigint
) as $$
  with eligible as (
    select
      m.id,
      m.is_adult,
      case when coalesce(m.local_mehman, '') = 'Mehman' then 'mehman' else 'local' end as grp
    from public.mumineen m
    join public.families f on f.id = m.family_id
    where m.roster_active = true
      and m.not_attending = false
      and f.roster_active = true
      and (coalesce(m.local_mehman, '') <> 'Mehman' or f.registration_status = 'submitted')
  ),
  member_rows as (
    select
      e.grp,
      e.is_adult,
      r.attending,
      coalesce(r.source in ('whatsapp', 'admin'), false) as responded
    from eligible e
    left join public.niyaz_rsvp r
      on r.mumin_id = e.id and r.registration_instance_id = p_instance_id
  ),
  member_agg as (
    select
      grp,
      count(*)                                                                        as eligible,
      count(*) filter (where responded and attending)                                 as yes,
      count(*) filter (where responded and not attending)                             as no,
      count(*) filter (where responded and attending and coalesce(is_adult, true))    as yes_adults,
      count(*) filter (where responded and attending and is_adult = false)            as yes_kids,
      count(*) filter (where responded and not attending and coalesce(is_adult, true)) as no_adults,
      count(*) filter (where responded and not attending and is_adult = false)        as no_kids,
      count(*) filter (where responded)                                               as responded,
      count(*) filter (where not responded)                                           as not_responded
    from member_rows
    group by grp
  ),
  guest_agg as (
    select
      'guest'::text                                                                    as grp,
      0::bigint                                                                        as eligible,
      count(*) filter (where r.attending)                                              as yes,
      0::bigint                                                                        as no,
      count(*) filter (where r.attending and coalesce(m.is_adult, true))               as yes_adults,
      count(*) filter (where r.attending and m.is_adult = false)                       as yes_kids,
      0::bigint                                                                        as no_adults,
      0::bigint                                                                        as no_kids,
      count(*) filter (where r.attending)                                              as responded,
      0::bigint                                                                        as not_responded
    from public.niyaz_rsvp r
    join public.mumineen m on m.id = r.mumin_id
    where r.registration_instance_id = p_instance_id
      and m.its like '00000%'
      and r.source in ('whatsapp', 'admin')
    having count(*) filter (where r.attending) > 0
  )
  select * from member_agg
  union all
  select * from guest_agg;
$$ language sql security invoker stable;
