-- Align global user access with account role while preserving department-level PM/HOD/member permissions.

create or replace function public.get_user_permissions(p_phone text)
returns jsonb language plpgsql as $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
begin
  select * into u from public.whatsapp_users where phone_e164 = p_phone;
  if not found then return '{"global_role":"unknown"}'::jsonb; end if;

  if u.role = 'admin' or u.global_role = 'leadership_admin' then
    return jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'role', u.role,
      'global_role', 'leadership_admin',
      'can_read_all', true,
      'can_write_all', true,
      'departments', '[]'::jsonb
    );
  end if;

  select jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) into dept_roles
  from public.department_members dm
  join public.departments d on d.id = dm.department_id
  where dm.user_id = u.id and dm.is_active = true;

  return jsonb_build_object(
    'user_id', u.id,
    'display_name', u.display_name,
    'role', u.role,
    'global_role', coalesce(u.global_role, 'member'),
    'can_read_all', false,
    'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb)
  );
end;
$$;
