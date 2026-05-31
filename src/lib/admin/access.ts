export type PortalUser = {
  role?: string | null;
  global_role?: string | null;
  is_support?: boolean | null;
};

export function isAdminOrLeadership(user: PortalUser | null | undefined) {
  return user?.role === "admin" || user?.global_role === "leadership_admin";
}

// Who may open the Lead Inbox: admins/leadership plus on-call support members.
export function canAccessInbox(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_support === true;
}
