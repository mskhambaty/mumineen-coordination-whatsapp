import { describe, expect, it } from "vitest";

import {
  canAccessMumineen,
  canImportMumineen,
  canManageInternalTools,
  canManageKnowledge,
  canManageParking,
  canViewRegistrationDetail,
  canViewRegistrations,
} from "@/lib/admin/access";

const committeeMember = { role: "committee", global_role: "member" } as const;
const committeePm = { role: "committee", global_role: "pm", is_manager: true } as const;
const admin = { role: "admin", global_role: "leadership_admin" } as const;
const visitor = { role: "visitor" } as const;

describe("baseline portal tier (open to all portal users)", () => {
  it("Mumineen roster page/reads, Registration, and Workspace pages allow any portal user", () => {
    for (const predicate of [canAccessMumineen, canViewRegistrations, canManageInternalTools]) {
      expect(predicate(committeeMember)).toBe(true);
      expect(predicate(committeePm)).toBe(true);
      expect(predicate(admin)).toBe(true);
      expect(predicate(visitor)).toBe(false);
      expect(predicate(null)).toBe(false);
    }
  });
});

describe("roster bulk import stays tight", () => {
  it("allows admins/leadership and IT, denies plain committee members", () => {
    expect(canImportMumineen(admin)).toBe(true);
    expect(canImportMumineen({ is_it: true })).toBe(true);
    expect(canImportMumineen(committeeMember)).toBe(false);
    expect(canImportMumineen(committeePm)).toBe(false);
    expect(canImportMumineen(null)).toBe(false);
  });
});

describe("registration drill-down detail stays PM/HOD", () => {
  it("allows admins/leadership and department PM/HOD, denies plain committee members", () => {
    expect(canViewRegistrationDetail(admin)).toBe(true);
    expect(canViewRegistrationDetail(committeePm)).toBe(true);
    expect(canViewRegistrationDetail(committeeMember)).toBe(false);
    expect(canViewRegistrationDetail(visitor)).toBe(false);
    expect(canViewRegistrationDetail(null)).toBe(false);
  });
});

describe("AI-agent knowledge tools stay PM/HOD", () => {
  it("allows admins/leadership and managers, denies plain members", () => {
    expect(canManageKnowledge(admin)).toBe(true);
    expect(canManageKnowledge(committeePm)).toBe(true);
    expect(canManageKnowledge(committeeMember)).toBe(false);
  });
});

describe("parking writes stay tight", () => {
  it("allows admins/leadership, IT, Transport; denies plain committee members", () => {
    expect(canManageParking(admin)).toBe(true);
    expect(canManageParking({ is_it: true })).toBe(true);
    expect(canManageParking({ is_transport: true })).toBe(true);
    expect(canManageParking(committeeMember)).toBe(false);
  });
});
