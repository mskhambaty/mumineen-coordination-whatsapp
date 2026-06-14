-- Religious monitors: a small dedicated team that ONLY oversees religious chats (the agent's
-- waaz/Lisan answers), on their own isolated dashboard — kept entirely separate from the
-- logistics/event admin. Mirrors escalation_support_members: a side membership table + a derived
-- portal flag (is_religious_monitor), so we don't touch the whatsapp_users.role CHECK constraint.

create table public.religious_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.whatsapp_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.religious_monitors enable row level security;

comment on table public.religious_monitors is
  'Users who may monitor religious chats on /admin/religious (and nothing else, unless otherwise privileged).';

-- Extend get_user_permissions_by_id to also surface is_religious_monitor (additive — every existing
-- field, incl. is_escalation_support and all logistics derivations, is unchanged).
create or replace function public.get_user_permissions_by_id(p_user_id uuid)
returns jsonb language plpgsql as $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
  v_is_support boolean;
  v_is_religious_monitor boolean;
begin
  select * into u from public.whatsapp_users where id = p_user_id;
  if not found or coalesce(u.status, 'active') <> 'active' then
    return '{"global_role":"unknown"}'::jsonb;
  end if;

  select exists(
    select 1 from public.escalation_support_members esm where esm.user_id = u.id
  ) into v_is_support;

  select exists(
    select 1 from public.religious_monitors rm where rm.user_id = u.id
  ) into v_is_religious_monitor;

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
      'is_escalation_support', v_is_support,
      'is_religious_monitor', v_is_religious_monitor
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
    'is_escalation_support', v_is_support,
    'is_religious_monitor', v_is_religious_monitor
  );
end;
$$;
