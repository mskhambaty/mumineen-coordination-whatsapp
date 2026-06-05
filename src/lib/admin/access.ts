export type PortalUser = {
  role?: string | null;
  global_role?: string | null;
  is_support?: boolean | null;
  is_manager?: boolean | null;
  is_it?: boolean | null;
  is_internal?: boolean | null;
};

export function isAdminOrLeadership(user: PortalUser | null | undefined) {
  return user?.role === "admin" || user?.global_role === "leadership_admin";
}

// Who may open the Mumineen roster page: admins/leadership plus IT department members.
export function canAccessMumineen(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_it === true;
}

// Who may open the Lead Inbox: admins/leadership plus on-call support members.
export function canAccessInbox(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_support === true;
}

// Who may upload FAQ/guide documents: admins/leadership plus department PM/HOD.
export function canManageKnowledge(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_manager === true;
}

// Internal PM tools (tasks, milestones, transcript uploads): admins/leadership plus department
// PM/HOD — the nav's "manage" level. Plain internal members get Registration Analytics + Profile only.
export function canManageInternalTools(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_manager === true;
}

// Who may open the Registration Analytics page: admins/leadership plus any internal user
// (assigned to a department) — regular team members shouldn't need manager permissions for it.
// is_manager/is_it kept as fallbacks for sessions stored before is_internal existed.
export function canViewRegistrations(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_internal === true || user?.is_manager === true || user?.is_it === true;
}
