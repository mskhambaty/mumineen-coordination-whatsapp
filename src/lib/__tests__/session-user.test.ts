import { beforeEach, describe, expect, it, vi } from "vitest";

// All membership lookups are stubbed so the test is pure: each returns false unless a case
// overrides it. The point is that buildPortalSessionUser surfaces is_religious_monitor at login
// (regression: it was dropped, so monitors logged in without the flag and the /admin/religious
// gate + nav bounced them even though they were on the team).
const mocks = vi.hoisted(() => ({
  isEscalationSupportMember: vi.fn(),
  isDepartmentManager: vi.fn(),
  isItMember: vi.fn(),
  isTransportMember: vi.fn(),
  isAccommodationsMember: vi.fn(),
  isDepartmentMember: vi.fn(),
  isReligiousMonitor: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => mocks);

import { buildPortalSessionUser } from "@/lib/admin/session";

const SRC = { id: "u1", display_name: "Monitor", email: "m@x.com", role: "visitor", global_role: null };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockResolvedValue(false);
});

describe("buildPortalSessionUser", () => {
  it("surfaces is_religious_monitor=true for a user on the monitor team", async () => {
    mocks.isReligiousMonitor.mockResolvedValue(true);
    const u = await buildPortalSessionUser(SRC);
    expect(u.is_religious_monitor).toBe(true);
    expect(mocks.isReligiousMonitor).toHaveBeenCalledWith("u1");
  });

  it("is_religious_monitor=false when the user is not on the team", async () => {
    const u = await buildPortalSessionUser(SRC);
    expect(u.is_religious_monitor).toBe(false);
  });
});
