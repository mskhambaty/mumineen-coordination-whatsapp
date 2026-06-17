-- escalation_status is a coarse projection of escalation_stage and was hand-maintained on every
-- write, so the two could (and did) diverge. Make escalation_stage the single source of truth and
-- DERIVE escalation_status from it via a trigger, so they can never diverge again.
--
-- (A literal GENERATED column would be cleaner but can't be applied to the live table without the
-- currently-deployed build's escalation_status writes erroring during the deploy window — the
-- trigger gives the same guarantee and is safe with both old and new code.)

create or replace function public.escalation_status_from_stage(stage text)
returns text language sql immutable as $$
  select case
    when stage = 'resolved' then 'resolved'
    when stage is null or stage = 'none' then 'none'
    else 'pending'   -- pending / picked_up / waiting_on_department
  end;
$$;

create or replace function public.set_escalation_status_from_stage()
returns trigger language plpgsql as $$
begin
  new.escalation_status := public.escalation_status_from_stage(new.escalation_stage);
  return new;
end;
$$;

drop trigger if exists trg_escalation_status_from_stage on public.conversation_sessions;
create trigger trg_escalation_status_from_stage
  before insert or update on public.conversation_sessions
  for each row execute function public.set_escalation_status_from_stage();

-- Recompute existing rows so status is consistent with stage everywhere (idempotent).
update public.conversation_sessions
set escalation_status = public.escalation_status_from_stage(escalation_stage)
where escalation_status is distinct from public.escalation_status_from_stage(escalation_stage);
