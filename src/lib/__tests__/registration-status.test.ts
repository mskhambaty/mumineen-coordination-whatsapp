import { describe, expect, it } from "vitest";

import { isPendingStatus, isRegisteredStatus, matchesStatusFilter } from "@/lib/registration/status";

describe("registration status helpers", () => {
  it("classifies registered statuses", () => {
    expect(isRegisteredStatus("submitted")).toBe(true);
    expect(isRegisteredStatus("confirmed")).toBe(true);
    expect(isRegisteredStatus("not_started")).toBe(false);
    expect(isRegisteredStatus("cancelled")).toBe(false);
    expect(isRegisteredStatus(null)).toBe(false);
  });

  it("treats not_started (and pending/null equivalents) as pending, never cancelled", () => {
    expect(isPendingStatus("not_started")).toBe(true);
    expect(isPendingStatus("pending")).toBe(true);
    expect(isPendingStatus(null)).toBe(true);
    expect(isPendingStatus("submitted")).toBe(false);
    expect(isPendingStatus("confirmed")).toBe(false);
    expect(isPendingStatus("cancelled")).toBe(false);
  });

  it("matches a status against a UI filter / drill value", () => {
    // The bug this fixes: a 'pending' filter must match the live 'not_started' value.
    expect(matchesStatusFilter("not_started", "pending")).toBe(true);
    expect(matchesStatusFilter("pending", "pending")).toBe(true);
    expect(matchesStatusFilter("submitted", "pending")).toBe(false);

    expect(matchesStatusFilter("submitted", "submitted")).toBe(true);
    expect(matchesStatusFilter("confirmed", "submitted")).toBe(true);
    expect(matchesStatusFilter("not_started", "submitted")).toBe(false);

    expect(matchesStatusFilter("cancelled", "cancelled")).toBe(true);
    expect(matchesStatusFilter("not_started", "cancelled")).toBe(false);
  });
});
