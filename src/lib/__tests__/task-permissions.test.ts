import { describe, expect, it } from "vitest";

import { canWriteTasks, canUseTaskTool } from "@/lib/permissions";

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

describe("canUseTaskTool", () => {
  it("allows read tools for all roles", () => {
    expect(canUseTaskTool("member", "get_my_tasks")).toBe(true);
    expect(canUseTaskTool("pm", "get_task_detail")).toBe(true);
    expect(canUseTaskTool("hod", "get_department_summary")).toBe(true);
  });

  it("allows write tools for pm, hod, leadership_admin", () => {
    expect(canUseTaskTool("pm", "update_task_status")).toBe(true);
    expect(canUseTaskTool("hod", "create_task")).toBe(true);
    expect(canUseTaskTool("leadership_admin", "assign_task")).toBe(true);
  });

  it("blocks write tools for member", () => {
    expect(canUseTaskTool("member", "update_task_status")).toBe(false);
    expect(canUseTaskTool("member", "create_task")).toBe(false);
  });

  it("allows leadership tools only for leadership_admin", () => {
    expect(canUseTaskTool("leadership_admin", "get_all_departments_summary")).toBe(true);
    expect(canUseTaskTool("leadership_admin", "get_department_tasks")).toBe(true);
  });

  it("blocks leadership tools for non-leadership roles", () => {
    expect(canUseTaskTool("pm", "get_all_departments_summary")).toBe(false);
    expect(canUseTaskTool("hod", "get_department_tasks")).toBe(false);
    expect(canUseTaskTool("member", "get_all_departments_summary")).toBe(false);
  });
});
