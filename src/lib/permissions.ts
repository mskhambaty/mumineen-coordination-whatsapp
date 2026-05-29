export type UserRole = "visitor" | "committee" | "admin";

export type AppUser = {
  id?: string;
  phone_e164: string;
  display_name?: string | null;
  role: UserRole;
  status?: string | null;
};

export const publicTools = new Set([
  "get_event_schedule",
  "get_parking_info",
  "get_directions",
  "get_faq_answer",
  "get_lost_found_info",
]);

export const committeeTools = new Set([
  "get_volunteer_assignment",
  "lookup_committee_contact",
  "update_volunteer_status",
  "create_internal_note",
]);

export function canUseTool(user: Pick<AppUser, "role" | "status">, toolName: string) {
  if (user.status && user.status !== "active") {
    return false;
  }

  if (publicTools.has(toolName)) {
    return true;
  }

  if (committeeTools.has(toolName)) {
    return user.role === "committee" || user.role === "admin";
  }

  return false;
}
