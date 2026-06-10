-- Issues: independent entity for grouping related escalations.
-- An issue can link to multiple escalation conversations; each conversation
-- links to at most one issue via linked_issue_id.

-- 1. Issues table
CREATE TABLE public.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_number serial UNIQUE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','resolved')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high')),
  department_id uuid REFERENCES public.departments(id),
  assigned_to uuid REFERENCES public.whatsapp_users(id),
  created_by uuid REFERENCES public.whatsapp_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

CREATE INDEX issues_status_idx ON public.issues (status) WHERE status != 'resolved';
CREATE INDEX issues_department_idx ON public.issues (department_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_issues_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.set_issues_updated_at();

-- 2. Junction table: issue ↔ conversation_sessions (many-to-many)
CREATE TABLE public.issue_escalation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  conversation_session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES public.whatsapp_users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, conversation_session_id)
);

ALTER TABLE public.issue_escalation_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX issue_escalation_links_issue_idx
  ON public.issue_escalation_links (issue_id);
CREATE INDEX issue_escalation_links_session_idx
  ON public.issue_escalation_links (conversation_session_id);

-- 3. Quick "primary issue" FK on conversation_sessions
ALTER TABLE public.conversation_sessions
  ADD COLUMN IF NOT EXISTS linked_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversation_sessions_linked_issue_idx
  ON public.conversation_sessions (linked_issue_id) WHERE linked_issue_id IS NOT NULL;

-- 4. Extend activity log with issue_id + new action types
ALTER TABLE public.escalation_activity_log
  ADD COLUMN IF NOT EXISTS issue_id uuid REFERENCES public.issues(id) ON DELETE CASCADE;

ALTER TABLE public.escalation_activity_log
  DROP CONSTRAINT IF EXISTS escalation_activity_log_action_check;

ALTER TABLE public.escalation_activity_log
  ADD CONSTRAINT escalation_activity_log_action_check
  CHECK (action IN (
    'escalated','picked_up','created_task','linked_to_task',
    'unlinked_from_task','resolved','bulk_resolved','reassigned',
    'created_issue','linked_to_issue','unlinked_from_issue','issue_resolved'
  ));
