import { describe, expect, it } from "vitest";

import { assembleBreakdown, hasResponded, isKid, isMehman, type BreakdownRpcRow } from "@/lib/rsvp/niyaz-breakdown";

// assembleBreakdown turns the niyaz_event_breakdown RPC rows into the event-detail panel grid. The RPC
// aggregates the "eligible to RSVP" population (Local + submitted-attending Mehmaan) confirmation-side
// (whatsapp/admin), plus a guest row for sentinel-ITS placeholders that RSVP'd yes. The counts come
// from a DB aggregate precisely because the per-mumin row list is capped at 1000 and can't be counted.

// Real-shaped fixture (the 4th Moharram lunch event): bigints may arrive as strings over PostgREST.
const localRow: BreakdownRpcRow = {
  grp: "local",
  eligible: 1526,
  yes: 833, no: 335,
  yes_adults: 685, yes_kids: 148, no_adults: 244, no_kids: 91,
  responded: "1168", not_responded: "358", // strings on purpose — coercion check
};
const mehmanRow: BreakdownRpcRow = {
  grp: "mehman",
  eligible: 789,
  yes: 575, no: 72,
  yes_adults: 500, yes_kids: 75, no_adults: 53, no_kids: 19,
  responded: 647, not_responded: 142,
};
const guestRow: BreakdownRpcRow = {
  grp: "guest",
  eligible: 0,
  yes: 88, no: 0,
  yes_adults: 88, yes_kids: 0, no_adults: 0, no_kids: 0,
  responded: 88, not_responded: 0,
};
const rows = [localRow, mehmanRow, guestRow];

describe("assembleBreakdown", () => {
  it("maps each group's confirmation-based yes/no and eligible population", () => {
    const b = assembleBreakdown(rows);
    expect(b.local).toMatchObject({ eligible: 1526, yes: 833, no: 335, yesAdults: 685, yesKids: 148, noAdults: 244, noKids: 91 });
    expect(b.mehman).toMatchObject({ eligible: 789, yes: 575, no: 72 });
    expect(b.guest).toMatchObject({ yes: 88, no: 0 });
  });

  it("rolls Local + Mehmaan into the member Total and excludes guests", () => {
    const b = assembleBreakdown(rows);
    expect(b.total).toMatchObject({ eligible: 2315, yes: 1408, no: 407, responded: 1815, notResponded: 500 });
    // Guests (88 yes) are NOT in the member total.
    expect(b.total.yes).toBe(b.local.yes + b.mehman.yes);
  });

  it("treats Responded = Yes + No and Eligible = Responded + Not responded", () => {
    const b = assembleBreakdown(rows);
    for (const g of [b.local, b.mehman, b.total]) {
      expect(g.responded).toBe(g.yes + g.no);
      expect(g.eligible).toBe(g.responded + g.notResponded);
    }
  });

  it("computes response rate as responded / eligible (coercing string counts)", () => {
    const b = assembleBreakdown(rows);
    expect(b.local.responseRate).toBeCloseTo(1168 / 1526, 5);
    expect(b.mehman.responseRate).toBeCloseTo(647 / 789, 5);
    expect(b.total.responseRate).toBeCloseTo(1815 / 2315, 5);
    // Guests have no eligible population → rate 0 (rendered as "—").
    expect(b.guest.responseRate).toBe(0);
  });

  it("handles an empty event with a 0 response rate", () => {
    const b = assembleBreakdown([]);
    expect(b.total).toMatchObject({ eligible: 0, yes: 0, no: 0, responded: 0, notResponded: 0, responseRate: 0 });
    expect(b.guest).toMatchObject({ yes: 0 });
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
    expect(hasResponded("roster")).toBe(false);
    expect(hasResponded("registration")).toBe(false);
  });
});
