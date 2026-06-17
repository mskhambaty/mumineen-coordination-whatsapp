import { describe, expect, it } from "vitest";

import { assembleBreakdown, hasResponded, isKid, isMehman, type BreakdownRpcRow } from "@/lib/rsvp/niyaz-breakdown";

// assembleBreakdown turns the niyaz_event_breakdown RPC rows (one per local/mehman group, with both
// min and max columns) into the local/mehman/total grid the event-detail panel renders. It must pick
// the columns for the active mode and roll the groups up into a correct total — the counts come from
// a DB aggregate precisely because the per-mumin row list is capped at 1000 and can't be counted.

// Real-shaped fixture (the 4th Moharram lunch event): bigints may arrive as strings over PostgREST.
const localRow: BreakdownRpcRow = {
  is_mehman: false,
  yes_min: 922, no_min: 432,
  yes_adults_min: 774, yes_kids_min: 148, no_adults_min: 341, no_kids_min: 91,
  yes_max: 1276, no_max: 480,
  yes_adults_max: 1061, yes_kids_max: 215, no_adults_max: 385, no_kids_max: 95,
  responded: "1354", not_responded: "402", // strings on purpose — coercion check
};
const mehmanRow: BreakdownRpcRow = {
  is_mehman: true,
  yes_min: 589, no_min: 251,
  yes_adults_min: 511, yes_kids_min: 78, no_adults_min: 203, no_kids_min: 48,
  yes_max: 945, no_max: 521,
  yes_adults_max: 807, yes_kids_max: 138, no_adults_max: 412, no_kids_max: 109,
  responded: 840, not_responded: 626,
};
const rows = [localRow, mehmanRow];

describe("assembleBreakdown", () => {
  it("uses the min columns and totals reconcile with the headline (1511/683)", () => {
    const b = assembleBreakdown(rows, "min");
    expect(b.local).toMatchObject({ yes: 922, no: 432, yesAdults: 774, yesKids: 148, noAdults: 341, noKids: 91 });
    expect(b.mehman).toMatchObject({ yes: 589, no: 251, yesAdults: 511, yesKids: 78, noAdults: 203, noKids: 48 });
    expect(b.total).toMatchObject({ yes: 1511, no: 683, yesAdults: 1285, yesKids: 226, noAdults: 544, noKids: 139 });
  });

  it("uses the max columns in max mode", () => {
    const b = assembleBreakdown(rows, "max");
    expect(b.local).toMatchObject({ yes: 1276, no: 480 });
    expect(b.mehman).toMatchObject({ yes: 945, no: 521 });
    expect(b.total).toMatchObject({ yes: 2221, no: 1001 });
  });

  it("reports responded/not-responded (coerced from strings) independent of mode", () => {
    for (const mode of ["min", "max"] as const) {
      const b = assembleBreakdown(rows, mode);
      expect(b.local).toMatchObject({ responded: 1354, notResponded: 402 });
      expect(b.mehman).toMatchObject({ responded: 840, notResponded: 626 });
      expect(b.total).toMatchObject({ responded: 2194, notResponded: 1028 });
    }
  });

  it("computes response rate per group", () => {
    const b = assembleBreakdown(rows, "min");
    expect(b.local.responseRate).toBeCloseTo(1354 / (1354 + 402), 5);
    expect(b.mehman.responseRate).toBeCloseTo(840 / (840 + 626), 5);
    expect(b.total.responseRate).toBeCloseTo(2194 / (2194 + 1028), 5);
  });

  it("reconciles group totals (local + mehman = total)", () => {
    const b = assembleBreakdown(rows, "max");
    for (const key of ["yes", "no", "yesAdults", "yesKids", "responded", "notResponded"] as const) {
      expect(b.local[key] + b.mehman[key]).toBe(b.total[key]);
    }
  });

  it("handles an empty event with a 0 response rate", () => {
    const b = assembleBreakdown([], "min");
    expect(b.total).toMatchObject({ yes: 0, no: 0, responded: 0, notResponded: 0, responseRate: 0 });
  });
});

describe("classifiers (used by the responses-table chip filters)", () => {
  it("treats only an explicit 'Mehman' as mehmaan", () => {
    expect(isMehman("Mehman")).toBe(true);
    expect(isMehman("Local")).toBe(false);
    expect(isMehman(null)).toBe(false);
  });

  it("treats only is_adult === false as a kid (null = adult)", () => {
    expect(isKid(false)).toBe(true);
    expect(isKid(true)).toBe(false);
    expect(isKid(null)).toBe(false);
  });

  it("counts only whatsapp/admin as responded", () => {
    expect(hasResponded("whatsapp")).toBe(true);
    expect(hasResponded("admin")).toBe(true);
    expect(hasResponded("default")).toBe(false);
    expect(hasResponded("registration")).toBe(false);
  });
});
