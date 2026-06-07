-- Portal session auth (issue #80): resolve permissions by user id instead of phone.
-- Differences from get_user_permissions(p_phone):
--   * inactive users resolve to unknown (deactivating a user revokes portal access)
--   * departments are included even for admins (portal flags derive from dept names)
--   * adds is_escalation_support for the portal page-gate predicates

create or replace function public.get_user_permissions_by_id(p_user_id uuid)
returns jsonb language plpgsql as $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
  v_is_support boolean;
begin
  select * into u from public.whatsapp_users where id = p_user_id;
  if not found or coalesce(u.status, 'active') <> 'active' then
    return '{"global_role":"unknown"}'::jsonb;
  end if;

  select exists(
    select 1 from public.escalation_support_members esm where esm.user_id = u.id
  ) into v_is_support;

  select jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) into dept_roles
  from public.department_members dm
  join public.departments d on d.id = dm.department_id
  where dm.user_id = u.id and dm.is_active = true;

  if u.role = 'admin' or u.global_role = 'leadership_admin' then
    return jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'role', u.role,
      'global_role', 'leadership_admin',
      'can_read_all', true,
      'can_write_all', true,
      'departments', coalesce(dept_roles, '[]'::jsonb),
      'is_escalation_support', v_is_support
    );
  end if;

  return jsonb_build_object(
    'user_id', u.id,
    'display_name', u.display_name,
    'role', u.role,
    'global_role', coalesce(u.global_role, 'member'),
    'can_read_all', false,
    'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb),
    'is_escalation_support', v_is_support
  );
end;
$$;
