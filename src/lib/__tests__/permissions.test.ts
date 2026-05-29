import { describe, expect, it } from "vitest";

import { canUseTool } from "@/lib/permissions";

describe("canUseTool", () => {
  it("allows public tools for visitors", () => {
    expect(canUseTool({ role: "visitor", status: "active" }, "get_event_schedule")).toBe(true);
  });

  it("blocks committee tools for visitors", () => {
    expect(canUseTool({ role: "visitor", status: "active" }, "lookup_committee_contact")).toBe(
      false,
    );
  });

  it("allows committee tools for committee users", () => {
    expect(canUseTool({ role: "committee", status: "active" }, "lookup_committee_contact")).toBe(
      true,
    );
  });

  it("blocks inactive users", () => {
    expect(canUseTool({ role: "admin", status: "inactive" }, "lookup_committee_contact")).toBe(
      false,
    );
  });
});
