-- Fix finalize_mumineen_import: add a WHERE clause to every UPDATE (Supabase enforces
-- safe-updates). Each UPDATE now only touches rows whose value actually changes.
-- Reconstructed from the live database.

create or replace function public.finalize_mumineen_import(p_its text[], p_hof text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Mark heads (a person whose ITS equals their family's HOF ITS). Only touch changed rows.
  update public.mumineen
    set is_head = (its = hof_its), updated_at = now()
    where is_head is distinct from (its = hof_its);

  -- Link families to their head person-row when present.
  update public.families f
    set head_in_roster = true, head_mumin_id = m.id, updated_at = now()
    from public.mumineen m
    where m.its = f.hof_its and m.roster_active
      and (f.head_in_roster is distinct from true or f.head_mumin_id is distinct from m.id);
  update public.families f
    set head_in_roster = false, head_mumin_id = null, updated_at = now()
    where f.head_in_roster is distinct from false
      and not exists (select 1 from public.mumineen m where m.its = f.hof_its and m.roster_active);

  -- Soft-deactivate rows that fell out of the latest roster file.
  update public.mumineen set roster_active = (its = any(p_its)), updated_at = now()
    where roster_active is distinct from (its = any(p_its));
  update public.families set roster_active = (hof_its = any(p_hof)), updated_at = now()
    where roster_active is distinct from (hof_its = any(p_hof));
end;
$function$;
