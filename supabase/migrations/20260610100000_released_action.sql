-- Add 'released' to the escalation activity log action check constraint
ALTER TABLE public.escalation_activity_log
  DROP CONSTRAINT IF EXISTS escalation_activity_log_action_check;

ALTER TABLE public.escalation_activity_log
  ADD CONSTRAINT escalation_activity_log_action_check
  CHECK (action IN (
    'escalated','picked_up','released','created_task','linked_to_task',
    'unlinked_from_task','resolved','bulk_resolved','reassigned',
    'created_issue','linked_to_issue','unlinked_from_issue','issue_resolved'
  ));
