import { describe, expect, it } from "vitest";

import { canManageParking, canViewParking } from "@/lib/admin/access";

describe("canManageParking", () => {
  it("allows admins", () => {
    expect(canManageParking({ role: "admin" })).toBe(true);
  });

  it("allows leadership", () => {
    expect(canManageParking({ global_role: "leadership_admin" })).toBe(true);
  });

  it("allows IT members", () => {
    expect(canManageParking({ is_it: true })).toBe(true);
  });

  it("allows Transport members", () => {
    expect(canManageParking({ is_transport: true })).toBe(true);
  });

  it("denies managers of other departments", () => {
    expect(canManageParking({ is_manager: true })).toBe(false);
  });

  it("denies plain internal members and null users", () => {
    expect(canManageParking({ is_internal: true })).toBe(false);
    expect(canManageParking(null)).toBe(false);
  });
});

describe("canViewParking", () => {
  // View is now the baseline portal tier: any signed-in portal user (committee or
  // admin) can open the parking page; writes/export still require canManageParking.
  it("allows any portal user (committee or admin)", () => {
    expect(canViewParking({ role: "committee" })).toBe(true);
    expect(canViewParking({ role: "admin" })).toBe(true);
    expect(canViewParking({ role: "admin", global_role: "leadership_admin" })).toBe(true);
  });

  it("denies visitors, bare department flags without a portal role, and null users", () => {
    expect(canViewParking({ role: "visitor" })).toBe(false);
    expect(canViewParking({ is_manager: true })).toBe(false);
    expect(canViewParking({ is_internal: true })).toBe(false);
    expect(canViewParking(null)).toBe(false);
  });
});
