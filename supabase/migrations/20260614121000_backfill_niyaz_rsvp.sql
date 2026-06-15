-- Backfill niyaz_rsvp for roster-active mumineen who have no rows yet (whole families that were
-- never seeded — they're on the roster but never ran through registration submit). Without this,
-- the "max" (optimistic) tally undercounts them. Uses the EXACT same arrival-date logic as
-- seed_family_niyaz_rsvp, applied to every roster-active mumin, filling only gaps.
--
-- source='default' → counted in max but excluded from the min (whatsapp/admin) tally, i.e. still
-- unconfirmed until the person/family actually responds. `on conflict do nothing` makes this
-- idempotent and guarantees existing whatsapp/admin/registration rows are never clobbered.

insert into public.niyaz_rsvp (registration_instance_id, mumin_id, family_id, attending, source)
select i.id, m.id, m.family_id,
  case
    when m.not_attending then false
    when m.arrival_at is null then true
    else ((m.arrival_at at time zone 'America/Chicago')::date <= i.event_date)
  end,
  'default'
from public.rsvp_registration_instance i
cross join public.mumineen m
where m.roster_active = true
  and i.event_date is not null
on conflict (registration_instance_id, mumin_id) do nothing;
