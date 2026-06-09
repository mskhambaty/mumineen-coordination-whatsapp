-- Drop on-call hours (all-or-nothing replaces scheduled shifts)
DROP TABLE IF EXISTS public.escalation_oncall_hours CASCADE;

-- Drop department routing from escalation_support_members; one row per user
ALTER TABLE public.escalation_support_members DROP COLUMN IF EXISTS department_id;

-- Ensure user_id is unique now that department scoping is gone
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.escalation_support_members'::regclass
      AND contype = 'u'
      AND conname = 'escalation_support_members_user_id_key'
  ) THEN
    ALTER TABLE public.escalation_support_members ADD CONSTRAINT escalation_support_members_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Department contacts: reference list the escalation/helpdesk team uses to
-- reach out to the right person in each department.
CREATE TABLE IF NOT EXISTS public.department_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  phone_e164 text,
  email text,
  notes text,
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.department_contacts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS department_contacts_department_id_idx
  ON public.department_contacts (department_id, display_order);
