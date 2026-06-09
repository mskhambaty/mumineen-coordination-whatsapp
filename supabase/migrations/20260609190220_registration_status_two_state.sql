-- Collapse families.registration_status to a two-state model: 'not_started' (pending submission)
-- and 'submitted' (registered). The 'in_progress', 'confirmed', and 'cancelled' values are removed
-- — none were ever written by the app. The soft-cancel columns go with them; unregistering a family
-- now resets it to 'not_started' and clears registration details in the app layer instead.

-- 1. Narrow the status CHECK constraint. Live data is only not_started/submitted, so this passes.
alter table public.families drop constraint if exists families_registration_status_check;
alter table public.families
  add constraint families_registration_status_check
  check (registration_status in ('not_started', 'submitted'));

-- 2. Drop the now-dead soft-cancel columns (always null; nothing reads them after this change).
alter table public.families drop column if exists cancelled_at;
alter table public.families drop column if exists cancelled_reason;

-- 3. The bot gate's "registered" check no longer references 'confirmed'.
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
    'registered', coalesce(bool_or(registration_status = 'submitted'), false),
    'in_roster', count(*) > 0,
    'member_count', count(*),
    'hof_its', (array_agg(hof_its))[1],
    'primary_mumin_its', (array_agg(its))[1],
    'status', (array_agg(registration_status))[1]
  )
  from matched;
$function$;
