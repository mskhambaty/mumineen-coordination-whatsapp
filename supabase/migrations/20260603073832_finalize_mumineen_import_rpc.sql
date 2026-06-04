-- RPC: post-import pass that sets head linkage and soft-deactivates rows missing from the file.
-- Reconstructed from the live database. NOTE: this initial version is superseded by
-- 20260603080740_finalize_mumineen_import_where.sql, which adds WHERE guards to every UPDATE
-- (the Supabase environment enforces safe-updates / requires a WHERE clause).

create or replace function public.finalize_mumineen_import(p_its text[], p_hof text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Mark heads (a person whose ITS equals their family's HOF ITS).
  update public.mumineen set is_head = (its = hof_its), updated_at = now();

  -- Link families to their head person-row when present.
  update public.families f
    set head_in_roster = true, head_mumin_id = m.id, updated_at = now()
    from public.mumineen m
    where m.its = f.hof_its and m.roster_active;
  update public.families f
    set head_in_roster = false, head_mumin_id = null, updated_at = now()
    where not exists (select 1 from public.mumineen m where m.its = f.hof_its and m.roster_active);

  -- Soft-deactivate rows that fell out of the latest roster file.
  update public.mumineen set roster_active = (its = any(p_its)), updated_at = now();
  update public.families set roster_active = (hof_its = any(p_hof)), updated_at = now();
end;
$function$;
