import { describe, expect, it } from "vitest";

import { canAccessPortal } from "@/lib/admin/access";

describe("canAccessPortal", () => {
  it("allows admins", () => {
    expect(canAccessPortal({ role: "admin", global_role: "leadership_admin" })).toBe(true);
  });

  it("allows committee members even with no department or flags", () => {
    expect(canAccessPortal({ role: "committee", global_role: "member" })).toBe(true);
    expect(
      canAccessPortal({
        role: "committee",
        global_role: "member",
        is_internal: false,
        is_manager: false,
        is_it: false,
        is_support: false,
        is_transport: false,
      }),
    ).toBe(true);
  });

  it("rejects visitors (the public/mumineen)", () => {
    expect(canAccessPortal({ role: "visitor", global_role: "member" })).toBe(false);
  });

  it("rejects users with no role and nullish input", () => {
    expect(canAccessPortal({ role: null })).toBe(false);
    expect(canAccessPortal(null)).toBe(false);
    expect(canAccessPortal(undefined)).toBe(false);
  });
});
