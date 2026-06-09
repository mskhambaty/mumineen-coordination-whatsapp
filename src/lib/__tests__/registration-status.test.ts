import { describe, expect, it } from "vitest";

import { isPendingStatus, isRegisteredStatus, matchesStatusFilter } from "@/lib/registration/status";

describe("registration status helpers (two-state: not_started | submitted)", () => {
  it("classifies registered status", () => {
    expect(isRegisteredStatus("submitted")).toBe(true);
    expect(isRegisteredStatus("not_started")).toBe(false);
    expect(isRegisteredStatus(null)).toBe(false);
  });

  it("classifies pending status as not_started", () => {
    expect(isPendingStatus("not_started")).toBe(true);
    expect(isPendingStatus("submitted")).toBe(false);
    expect(isPendingStatus(null)).toBe(false);
  });

  it("matches a status against a UI filter / drill value", () => {
    // The bug this fixes: a 'pending' filter must match the live 'not_started' value.
    expect(matchesStatusFilter("not_started", "pending")).toBe(true);
    expect(matchesStatusFilter("submitted", "pending")).toBe(false);

    expect(matchesStatusFilter("submitted", "submitted")).toBe(true);
    expect(matchesStatusFilter("not_started", "submitted")).toBe(false);
  });
});
