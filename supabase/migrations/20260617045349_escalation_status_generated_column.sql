-- Finisher: now that all live code writes only escalation_stage (never escalation_status), replace
-- the trigger-maintained escalation_status with a true GENERATED column so it's physically
-- impossible to write or diverge. Safe to apply only after the status-write refactor is deployed.

drop trigger if exists trg_escalation_status_from_stage on public.conversation_sessions;
drop index if exists public.conversation_sessions_escalation_status_idx;
alter table public.conversation_sessions drop column if exists escalation_status;

alter table public.conversation_sessions
  add column escalation_status text
  generated always as (
    case
      when escalation_stage = 'resolved' then 'resolved'
      when escalation_stage is null or escalation_stage = 'none' then 'none'
      else 'pending'   -- pending / picked_up / waiting_on_department
    end
  ) stored;

create index conversation_sessions_escalation_status_idx
  on public.conversation_sessions (escalation_status);

-- Trigger function no longer needed (pure helper escalation_status_from_stage() is kept).
drop function if exists public.set_escalation_status_from_stage();
