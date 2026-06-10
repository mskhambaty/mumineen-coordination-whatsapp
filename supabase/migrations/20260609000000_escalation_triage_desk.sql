-- Escalation triage desk: stage tracking, SLA, assignment, task linking, activity log.
-- No existing data is modified. New columns default to 'none'/null.

-- 1. Triage stage columns on conversation_sessions (alongside existing escalation_status).
ALTER TABLE public.conversation_sessions
  ADD COLUMN IF NOT EXISTS escalation_stage text NOT NULL DEFAULT 'none'
    CHECK (escalation_stage IN ('none','pending','picked_up','waiting_on_department','resolved')),
  ADD COLUMN IF NOT EXISTS escalation_assigned_to uuid REFERENCES public.whatsapp_users(id),
  ADD COLUMN IF NOT EXISTS escalation_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_sla_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS linked_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversation_sessions_escalation_stage_idx
  ON public.conversation_sessions (escalation_stage) WHERE escalation_stage != 'none';

CREATE INDEX IF NOT EXISTS conversation_sessions_sla_deadline_idx
  ON public.conversation_sessions (escalation_sla_deadline)
  WHERE escalation_sla_deadline IS NOT NULL AND escalation_stage NOT IN ('none','resolved');

CREATE INDEX IF NOT EXISTS conversation_sessions_linked_task_idx
  ON public.conversation_sessions (linked_task_id) WHERE linked_task_id IS NOT NULL;

-- 2. SLA config (2 rows: urgent + normal). Admin-editable defaults.
CREATE TABLE IF NOT EXISTS public.escalation_sla_config (
  priority text PRIMARY KEY CHECK (priority IN ('urgent','normal')),
  pickup_minutes integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.whatsapp_users(id)
);

ALTER TABLE public.escalation_sla_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.escalation_sla_config (priority, pickup_minutes)
VALUES ('urgent', 15), ('normal', 60)
ON CONFLICT (priority) DO NOTHING;

-- 3. Activity log: tracks every triage action on escalations and linked tasks.
CREATE TABLE IF NOT EXISTS public.escalation_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_session_id uuid REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  phone_e164 text,
  action text NOT NULL
    CHECK (action IN (
      'escalated','picked_up','created_task','linked_to_task',
      'unlinked_from_task','resolved','bulk_resolved','reassigned'
    )),
  actor_user_id uuid REFERENCES public.whatsapp_users(id),
  actor_label text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.escalation_activity_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS escalation_activity_log_session_idx
  ON public.escalation_activity_log (conversation_session_id);

CREATE INDEX IF NOT EXISTS escalation_activity_log_task_idx
  ON public.escalation_activity_log (task_id);
