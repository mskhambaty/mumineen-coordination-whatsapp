-- Add is_helpdesk flag directly on whatsapp_users.
-- Replaces the escalation_support_members join-table lookup for inbox/helpdesk access.
-- The escalation_support_members table is retained for escalation notification routing.

ALTER TABLE public.whatsapp_users
  ADD COLUMN IF NOT EXISTS is_helpdesk boolean NOT NULL DEFAULT false;

-- Update the permissions function to return is_helpdesk from the user row.
CREATE OR REPLACE FUNCTION public.get_user_permissions_by_id(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
  v_is_support boolean;
BEGIN
  SELECT * INTO u FROM public.whatsapp_users WHERE id = p_user_id;
  IF NOT FOUND OR coalesce(u.status, 'active') <> 'active' THEN
    RETURN '{"global_role":"unknown"}'::jsonb;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.escalation_support_members esm WHERE esm.user_id = u.id
  ) INTO v_is_support;

  SELECT jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) INTO dept_roles
  FROM public.department_members dm
  JOIN public.departments d ON d.id = dm.department_id
  WHERE dm.user_id = u.id AND dm.is_active = true;

  IF u.role = 'admin' OR u.global_role = 'leadership_admin' THEN
    RETURN jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'role', u.role,
      'global_role', 'leadership_admin',
      'can_read_all', true,
      'can_write_all', true,
      'departments', coalesce(dept_roles, '[]'::jsonb),
      'is_escalation_support', v_is_support,
      'is_helpdesk', u.is_helpdesk
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', u.id,
    'display_name', u.display_name,
    'role', u.role,
    'global_role', coalesce(u.global_role, 'member'),
    'can_read_all', false,
    'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb),
    'is_escalation_support', v_is_support,
    'is_helpdesk', u.is_helpdesk
  );
END;
$$;
