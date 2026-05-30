export type PortalUser = {
  role?: string | null;
  global_role?: string | null;
};

export function isAdminOrLeadership(user: PortalUser | null | undefined) {
  return user?.role === "admin" || user?.global_role === "leadership_admin";
}
