export type PortalUser = {
  role?: string | null;
  global_role?: string | null;
  is_support?: boolean | null;
  is_manager?: boolean | null;
  is_it?: boolean | null;
  is_internal?: boolean | null;
  is_transport?: boolean | null;
};

export function isAdminOrLeadership(user: PortalUser | null | undefined) {
  return user?.role === "admin" || user?.global_role === "leadership_admin";
}

// Front-door sign-in check: who may log in at all. Committee, Admin/Leadership,
// and Helpdesk users may sign in. Visitors (the public/mumineen) are always
// rejected. Helpdesk users land on the Inbox only — all data routes still
// require canAccessPortal (committee/admin), so they can't reach anything else.
export function canSignIn(user: PortalUser | null | undefined): boolean {
  return user?.role === "committee" || user?.role === "admin" || user?.role === "helpdesk";
}

// Baseline "internal staff" tier: any committee or admin user. Most coordination
// surfaces (Home analytics, Mumineen roster/registration/parking, Workspace
// tasks/milestones, Member Management) require this. Helpdesk is intentionally
// excluded — they only get canAccessInbox.
// See docs/access-control.md for the canonical role × page matrix.
export function canAccessPortal(user: PortalUser | null | undefined): boolean {
  return user?.role === "committee" || user?.role === "admin";
}

// Mumineen roster page + reads + routine corrections: any portal user.
// Heavy roster writes stay tighter — bulk import via canImportMumineen, and
// full-roster CSV export / member create / registration-gate control remain
// isAdminOrLeadership at their routes.
export function canAccessMumineen(user: PortalUser | null | undefined) {
  return canAccessPortal(user);
}

// Bulk roster spreadsheet import (overwrites many rows of PII): admins/leadership
// plus IT department members. Deliberately NOT opened to all portal users.
export function canImportMumineen(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_it === true;
}

// Who may open the Lead Inbox: admins/leadership, on-call support members, or
// users with the dedicated helpdesk role.
export function canAccessInbox(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.role === "helpdesk" || user?.is_support === true;
}

// AI-agent knowledge tools (Knowledge Base, Knowledge Gaps, Ashara Daily
// Content) + FAQ/religious content editors: admins/leadership plus department
// PM/HOD. Intentionally kept at PM/HOD (not opened to all portal users).
export function canManageKnowledge(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_manager === true;
}

// Workspace pages (Tasks, Milestones, Upload Transcripts, Daily Digest): open to
// every portal user. The page is visible to all; the data routes scope content
// to the caller's own departments (a deptless user simply sees empty lists), and
// task/milestone *writes* are still governed by dept role in those routes.
export function canManageInternalTools(user: PortalUser | null | undefined) {
  return canAccessPortal(user);
}

// Registration Analytics + Daily Digest + Accommodations: any portal user.
// (Drill-down detail and per-segment CSV live under the same gate.)
export function canViewRegistrations(user: PortalUser | null | undefined) {
  return canAccessPortal(user);
}

// Parking pass tool — full write (assign/revoke/edit lots/export CSV):
// admins/leadership, IT members, or Transport department members. Heavy writes
// over household PII stay on this tier.
export function canManageParking(user: PortalUser | null | undefined) {
  return isAdminOrLeadership(user) || user?.is_it === true || user?.is_transport === true;
}

// Parking pass tool — read-only view: any portal user. Writes still require
// canManageParking.
export function canViewParking(user: PortalUser | null | undefined) {
  return canAccessPortal(user);
}

// Accommodations module — host/guest views + matching: any portal user.
export function canManageAccommodations(user: PortalUser | null | undefined) {
  return canViewRegistrations(user);
}
