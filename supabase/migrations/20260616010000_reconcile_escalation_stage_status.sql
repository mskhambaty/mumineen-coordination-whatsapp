-- Reconcile escalation_stage with the canonical escalation_status lifecycle.
--
-- escalation_status (none|pending|resolved) is AUTHORITATIVE for open vs. resolved.
-- escalation_stage carries the work sub-state (picked_up, waiting_on_department) only
-- while an escalation is pending. Legacy resolve paths updated status without syncing
-- stage, leaving rows like (status=resolved, stage=picked_up) that show as "resolved"
-- to the tab system but still paint an SLA-breach badge in the issue panel (which read
-- stage). Both UPDATEs are idempotent — safe to re-run in any environment.

-- Resolved by status, stale stage → trust status, mark stage resolved.
update public.conversation_sessions
set escalation_stage = 'resolved'
where escalation_status = 'resolved'
  and escalation_stage is distinct from 'resolved';

-- Open by status, stage wrongly marked resolved → trust status, reopen stage to pending.
update public.conversation_sessions
set escalation_stage = 'pending'
where escalation_status = 'pending'
  and escalation_stage = 'resolved';
