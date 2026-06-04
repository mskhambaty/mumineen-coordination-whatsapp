-- RPC: resolve an inbound phone to its family's registration status (used by the bot gate).
-- Reconstructed from the live database.

create or replace function public.get_registration_status(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with matched as (
    select m.id as mumin_id, m.its, m.full_name, m.family_id, f.hof_its, f.registration_status
    from public.mumin_phone_links l
    join public.mumineen m on m.id = l.mumin_id
    join public.families f on f.id = m.family_id
    where l.phone_e164 = p_phone and m.roster_active
  )
  select jsonb_build_object(
    'registered', coalesce(bool_or(registration_status in ('submitted', 'confirmed')), false),
    'in_roster', count(*) > 0,
    'member_count', count(*),
    'hof_its', (array_agg(hof_its))[1],
    'primary_mumin_its', (array_agg(its))[1],
    'status', (array_agg(registration_status))[1]
  )
  from matched;
$function$;
