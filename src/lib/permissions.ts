export type UserRole = "visitor" | "committee" | "admin";
export type GlobalRole = "member" | "pm" | "hod" | "leadership_admin";
export type DeptRole = "member" | "pm" | "hod";

export type AppUser = {
  id?: string;
  phone_e164: string;
  display_name?: string | null;
  role: UserRole;
  status?: string | null;
  global_role?: GlobalRole;
};

export const publicTools = new Set([
  "get_site_content_faq",
  "move_to_escalation",
  "create_issue",
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
  "get_milestones",
]);

/** Task tools requiring pm, hod, or leadership_admin */
export const taskWriteTools = new Set([
  "update_task_status",
  "assign_task",
  "get_top_blockers",
  "update_milestone",
]);

/** Task tools any authenticated department member can start, scoped by API rules */
export const taskCreateTools = new Set([
  "create_task",
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
  if (taskReadTools.has(toolName) || taskCreateTools.has(toolName) || taskWriteTools.has(toolName) || leadershipTools.has(toolName)) {
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
  if (taskCreateTools.has(toolName)) {
    return globalRole !== "member";
  }
  if (leadershipTools.has(toolName)) {
    return globalRole === "leadership_admin";
  }
  return false;
}

export function canUseTaskToolForCaller(
  caller: {
    user_id?: string;
    global_role?: GlobalRole;
    can_read_all?: boolean;
    can_write_all?: boolean;
    departments?: Array<{ dept_role?: string | null }>;
  } | undefined,
  toolName: string,
): boolean {
  if (taskReadTools.has(toolName)) {
    return true;
  }

  const isLeadership = caller?.global_role === "leadership_admin" || caller?.can_read_all === true;
  if (leadershipTools.has(toolName)) {
    return isLeadership;
  }

  if (taskCreateTools.has(toolName)) {
    return (
      isLeadership ||
      caller?.can_write_all === true ||
      (caller?.departments?.length ?? 0) > 0
    );
  }

  if (taskWriteTools.has(toolName)) {
    return (
      isLeadership ||
      caller?.can_write_all === true ||
      caller?.departments?.some((department) => department.dept_role === "pm" || department.dept_role === "hod") === true
    );
  }

  return false;
}

export function hasElevatedDeptRole(
  caller: { departments?: Array<{ dept_role?: string | null }> } | undefined,
) {
  return caller?.departments?.some((department) => department.dept_role === "pm" || department.dept_role === "hod") === true;
}

export function getElevatedDepartmentIds(
  caller: { departments?: Array<{ department_id?: string | null; dept_role?: string | null }> } | undefined,
) {
  return (caller?.departments ?? [])
    .filter((department) => department.department_id && (department.dept_role === "pm" || department.dept_role === "hod"))
    .map((department) => department.department_id as string);
}

export function hasElevatedDeptRoleForDepartment(
  caller: { departments?: Array<{ department_id?: string | null; dept_role?: string | null }> } | undefined,
  departmentId: string,
) {
  return caller?.departments?.some(
    (department) =>
      department.department_id === departmentId &&
      (department.dept_role === "pm" || department.dept_role === "hod"),
  ) === true;
}
