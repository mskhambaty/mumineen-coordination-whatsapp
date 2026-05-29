export type UserRole = "visitor" | "committee" | "admin";
export type GlobalRole = "member" | "pm" | "hod" | "leadership_admin";

export type AppUser = {
  id?: string;
  phone_e164: string;
  display_name?: string | null;
  role: UserRole;
  status?: string | null;
  global_role?: GlobalRole;
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

/** Task tools accessible to all authenticated users */
export const taskReadTools = new Set([
  "get_my_tasks",
  "get_task_detail",
  "get_department_summary",
]);

/** Task tools requiring pm, hod, or leadership_admin */
export const taskWriteTools = new Set([
  "update_task_status",
  "create_task",
  "assign_task",
]);

/** Task tools requiring leadership_admin only */
export const leadershipTools = new Set([
  "get_all_departments_summary",
  "get_department_tasks",
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

  // Task tools are handled separately via canUseTaskTool
  if (taskReadTools.has(toolName) || taskWriteTools.has(toolName) || leadershipTools.has(toolName)) {
    return user.role === "committee" || user.role === "admin";
  }

  return false;
}

export function canWriteTasks(globalRole: GlobalRole, deptAccess: boolean): boolean {
  return globalRole === "leadership_admin" || (deptAccess && ["pm", "hod"].includes(globalRole));
}

export function canUseTaskTool(globalRole: GlobalRole, toolName: string): boolean {
  if (taskReadTools.has(toolName)) {
    return true; // All authenticated users can read
  }
  if (taskWriteTools.has(toolName)) {
    return globalRole === "leadership_admin" || globalRole === "pm" || globalRole === "hod";
  }
  if (leadershipTools.has(toolName)) {
    return globalRole === "leadership_admin";
  }
  return false;
}
