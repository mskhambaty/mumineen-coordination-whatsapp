import { describe, expect, it } from "vitest";

import { canUseTool } from "@/lib/permissions";

describe("canUseTool", () => {
  it("allows public tools for visitors", () => {
    expect(canUseTool({ role: "visitor", status: "active" }, "get_site_content_faq")).toBe(true);
  });

  it("blocks internal (task) tools for visitors", () => {
    expect(canUseTool({ role: "visitor", status: "active" }, "get_my_tasks")).toBe(false);
  });

  it("allows internal (task) tools for committee users", () => {
    expect(canUseTool({ role: "committee", status: "active" }, "get_my_tasks")).toBe(true);
  });

  it("blocks inactive users", () => {
    expect(canUseTool({ role: "admin", status: "inactive" }, "get_my_tasks")).toBe(false);
  });
});
