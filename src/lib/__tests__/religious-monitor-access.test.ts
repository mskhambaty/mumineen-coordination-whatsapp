import { describe, expect, it } from "vitest";

import { canMonitorReligiousChats, canManageReligiousContent, canSignIn, canAccessPortal } from "@/lib/admin/access";

const admin = { role: "admin" as const };
const monitorOnly = { role: "visitor" as const, is_religious_monitor: true };
const committee = { role: "committee" as const };
const visitor = { role: "visitor" as const };

describe("canMonitorReligiousChats", () => {
  it("allows admins/leadership and dedicated monitors; denies others", () => {
    expect(canMonitorReligiousChats(admin)).toBe(true);
    expect(canMonitorReligiousChats({ global_role: "leadership_admin" })).toBe(true);
    expect(canMonitorReligiousChats(monitorOnly)).toBe(true);
    expect(canMonitorReligiousChats(committee)).toBe(false);
    expect(canMonitorReligiousChats(visitor)).toBe(false);
    expect(canMonitorReligiousChats(null)).toBe(false);
  });
});

describe("canSignIn includes a dedicated monitor (even as a visitor role)", () => {
  it("lets a religious-monitor visitor sign in, but not a plain visitor", () => {
    expect(canSignIn(monitorOnly)).toBe(true);
    expect(canSignIn(visitor)).toBe(false);
  });
});

describe("a religious monitor gets NO logistics/portal access from the flag alone", () => {
  it("a monitor-only (visitor) user still fails canAccessPortal", () => {
    expect(canAccessPortal(monitorOnly)).toBe(false);
  });
});

describe("canManageReligiousContent (Waaz Talaqqi dictionary + content tabs)", () => {
  it("lets the monitor team + existing portal/knowledge managers manage, denies others", () => {
    expect(canManageReligiousContent(monitorOnly)).toBe(true); // the dedicated team
    expect(canManageReligiousContent(admin)).toBe(true);
    expect(canManageReligiousContent(committee)).toBe(true); // portal user, unchanged
    expect(canManageReligiousContent({ is_manager: true })).toBe(true); // knowledge manager
    expect(canManageReligiousContent(visitor)).toBe(false);
    expect(canManageReligiousContent(null)).toBe(false);
  });
});
