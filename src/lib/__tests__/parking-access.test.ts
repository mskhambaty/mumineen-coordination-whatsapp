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
  it("allows everyone who can manage", () => {
    expect(canViewParking({ is_transport: true })).toBe(true);
    expect(canViewParking({ is_it: true })).toBe(true);
    expect(canViewParking({ role: "admin" })).toBe(true);
  });

  it("allows managers of any department (read-only tier)", () => {
    expect(canViewParking({ is_manager: true })).toBe(true);
  });

  it("denies plain internal members and null users", () => {
    expect(canViewParking({ is_internal: true })).toBe(false);
    expect(canViewParking(null)).toBe(false);
  });
});
