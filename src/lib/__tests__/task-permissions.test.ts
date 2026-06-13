import { describe, expect, it } from "vitest";

import {
  canListAllDepartments,
  canUseTaskTool,
  canUseTaskToolForCaller,
  canWriteTasks,
  getElevatedDepartmentIds,
  hasElevatedDeptRoleForDepartment,
} from "@/lib/permissions";

describe("canWriteTasks", () => {
  it("returns true for leadership_admin regardless of dept access", () => {
    expect(canWriteTasks("leadership_admin", false)).toBe(true);
  });

  it("returns true for pm with dept access", () => {
    expect(canWriteTasks("pm", true)).toBe(true);
  });

  it("returns true for hod with dept access", () => {
    expect(canWriteTasks("hod", true)).toBe(true);
  });

  it("returns false for member even with dept access", () => {
    expect(canWriteTasks("member", true)).toBe(false);
  });

  it("returns false for pm without dept access", () => {
    expect(canWriteTasks("pm", false)).toBe(false);
  });
});

describe("canListAllDepartments", () => {
  it("allows internal committee users to discover the department directory", () => {
    expect(canListAllDepartments({ role: "committee", can_read_all: false })).toBe(true);
  });

  it("does not expose the full directory to visitors", () => {
    expect(canListAllDepartments({ role: "visitor", can_read_all: false })).toBe(false);
  });
});

describe("canUseTaskTool", () => {
  it("allows read tools for all roles", () => {
    expect(canUseTaskTool("member", "list_tasks")).toBe(true);
    expect(canUseTaskTool("pm", "list_departments")).toBe(true);
    expect(canUseTaskTool("hod", "list_department_members")).toBe(true);
  });

  it("allows write tools for pm, hod, leadership_admin", () => {
    expect(canUseTaskTool("pm", "update_tasks")).toBe(true);
    expect(canUseTaskTool("hod", "create_task")).toBe(true);
    expect(canUseTaskTool("leadership_admin", "update_tasks")).toBe(true);
  });

  it("blocks write tools for member", () => {
    expect(canUseTaskTool("member", "update_tasks")).toBe(false);
    expect(canUseTaskTool("member", "create_task")).toBe(false);
  });

  it("keeps the old fragmented tools unavailable", () => {
    expect(canUseTaskTool("leadership_admin", "update_task_status")).toBe(false);
    expect(canUseTaskTool("leadership_admin", "assign_task")).toBe(false);
  });
});

describe("canUseTaskToolForCaller", () => {
  it("allows department members to create their own tickets", () => {
    expect(canUseTaskToolForCaller({
      global_role: "member",
      departments: [{ dept_role: "member" }],
    }, "create_task")).toBe(true);
  });

  it("allows task writes for department PM or HOD callers", () => {
    expect(canUseTaskToolForCaller({
      global_role: "member",
      departments: [{ dept_role: "pm" }],
    }, "update_tasks")).toBe(true);
  });

  it("allows read tools for department PM/HOD callers", () => {
    expect(canUseTaskToolForCaller({
      global_role: "member",
      departments: [{ dept_role: "hod" }],
    }, "list_department_members")).toBe(true);
  });
});

describe("department role helpers", () => {
  it("returns only elevated departments", () => {
    expect(getElevatedDepartmentIds({
      departments: [
        { department_id: "dept-member", dept_role: "member" },
        { department_id: "dept-pm", dept_role: "pm" },
      ],
    })).toEqual(["dept-pm"]);
  });

  it("checks elevated access for the requested department only", () => {
    const caller = {
      departments: [
        { department_id: "dept-a", dept_role: "hod" },
        { department_id: "dept-b", dept_role: "member" },
      ],
    };

    expect(hasElevatedDeptRoleForDepartment(caller, "dept-a")).toBe(true);
    expect(hasElevatedDeptRoleForDepartment(caller, "dept-b")).toBe(false);
  });
});
