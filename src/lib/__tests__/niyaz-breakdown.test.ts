import { describe, expect, it } from "vitest";

import { computeNiyazBreakdown, type BreakdownRow } from "@/lib/rsvp/niyaz-breakdown";

// The breakdown drives the admin event-detail "Breakdown" panel: Yes/No (adults/kids) and
// responded/not-responded, split by local vs mehmaan. "max" counts every row; "min" counts only
// whatsapp/admin-sourced rows (mirroring niyaz_event_tallies_min). Responded is source-based and
// therefore mode-independent.

// A mixed fixture: local/mehman × adult/kid × yes/no × every source.
const rows: BreakdownRow[] = [
  // Locals
  { attending: true, source: "whatsapp", is_adult: null, local_mehman: "Local" }, // yes adult, responded
  { attending: true, source: "default", is_adult: false, local_mehman: "Local" }, // yes kid, not responded
  { attending: false, source: "admin", is_adult: true, local_mehman: "Local" }, // no adult, responded
  { attending: false, source: "registration", is_adult: false, local_mehman: null }, // no kid, not responded; null local => local
  // Mehmaans
  { attending: true, source: "admin", is_adult: true, local_mehman: "Mehman" }, // yes adult, responded
  { attending: true, source: "registration", is_adult: false, local_mehman: "Mehman" }, // yes kid, not responded
  { attending: false, source: "whatsapp", is_adult: null, local_mehman: "Mehman" }, // no adult, responded
  { attending: false, source: "default", is_adult: false, local_mehman: "Mehman" }, // no kid, not responded
];

describe("computeNiyazBreakdown", () => {
  it("counts every row in max mode, split by local/mehmaan and adult/kid", () => {
    const b = computeNiyazBreakdown(rows, "max");

    expect(b.local).toMatchObject({ yes: 2, no: 2, yesAdults: 1, yesKids: 1, noAdults: 1, noKids: 1 });
    expect(b.mehman).toMatchObject({ yes: 2, no: 2, yesAdults: 1, yesKids: 1, noAdults: 1, noKids: 1 });
    expect(b.total).toMatchObject({ yes: 4, no: 4, yesAdults: 2, yesKids: 2, noAdults: 2, noKids: 2 });
  });

  it("counts only whatsapp/admin rows for Yes/No in min mode", () => {
    const b = computeNiyazBreakdown(rows, "min");

    // Local: only the whatsapp-yes-adult and admin-no-adult survive.
    expect(b.local).toMatchObject({ yes: 1, no: 1, yesAdults: 1, yesKids: 0, noAdults: 1, noKids: 0 });
    // Mehman: only the admin-yes-adult and whatsapp-no-adult survive.
    expect(b.mehman).toMatchObject({ yes: 1, no: 1, yesAdults: 1, yesKids: 0, noAdults: 1, noKids: 0 });
    expect(b.total).toMatchObject({ yes: 2, no: 2 });
  });

  it("reports responded/not-responded by group, independent of mode", () => {
    for (const mode of ["min", "max"] as const) {
      const b = computeNiyazBreakdown(rows, mode);
      expect(b.local).toMatchObject({ responded: 2, notResponded: 2, responseRate: 0.5 });
      expect(b.mehman).toMatchObject({ responded: 2, notResponded: 2, responseRate: 0.5 });
      expect(b.total).toMatchObject({ responded: 4, notResponded: 4, responseRate: 0.5 });
    }
  });

  it("reconciles group totals (local + mehman = total)", () => {
    const b = computeNiyazBreakdown(rows, "max");
    for (const key of ["yes", "no", "responded", "notResponded"] as const) {
      expect(b.local[key] + b.mehman[key]).toBe(b.total[key]);
    }
  });

  it("handles an empty row set with a 0 response rate", () => {
    const b = computeNiyazBreakdown([], "min");
    expect(b.total).toMatchObject({ yes: 0, no: 0, responded: 0, notResponded: 0, responseRate: 0 });
  });
});
