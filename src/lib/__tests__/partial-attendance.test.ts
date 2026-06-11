import { describe, expect, it, vi, beforeEach } from "vitest";

// A family of 3: head (adult), spouse (adult), kid.
const FAMILY_MEMBERS = [
  { id: "m-head", not_attending: false, is_adult: true, is_head: true },
  { id: "m-spouse", not_attending: false, is_adult: true, is_head: false },
  { id: "m-kid", not_attending: false, is_adult: false, is_head: false },
];

const EVENTS = [
  { id: "e-21-dinner", title: "8th Moharram", event_date: "2026-06-21", hijri_date: null, meal: "dinner", serving_type: "packet", description: null },
];

// Track upserted rows so we can inspect per-member attending values.
const upsertedRows: Record<string, unknown>[][] = [];

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    not: () => builder,
    order: () => builder,
    eq: () => builder,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "rsvp_registration_instance") return makeBuilder({ data: EVENTS });
      if (table === "mumineen") return makeBuilder({ data: FAMILY_MEMBERS });
      if (table === "niyaz_rsvp") {
        return {
          select: () => makeBuilder({ data: [] }),
          upsert: (rows: Record<string, unknown>[]) => {
            upsertedRows.push(rows);
            return { error: null };
          },
        };
      }
      return makeBuilder({ data: [] });
    },
  }),
}));

import { setFamilyNiyazRsvp } from "@/lib/rsvp/meal-rsvp";

beforeEach(() => {
  upsertedRows.length = 0;
});

describe("setFamilyNiyazRsvp partial attendance", () => {
  it("marks all members attending when no partial counts given", async () => {
    await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: true, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
    );
    expect(upsertedRows).toHaveLength(1);
    const rows = upsertedRows[0];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.attending === true)).toBe(true);
  });

  it("marks only 1 adult attending when adults=1, kids=0", async () => {
    await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: true, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
      { adults: 1, kids: 0 },
    );
    expect(upsertedRows).toHaveLength(1);
    const rows = upsertedRows[0];
    expect(rows).toHaveLength(3);
    // Head of family stays attending.
    const head = rows.find((r) => r.mumin_id === "m-head");
    expect(head?.attending).toBe(true);
    // Spouse and kid not attending.
    const spouse = rows.find((r) => r.mumin_id === "m-spouse");
    expect(spouse?.attending).toBe(false);
    const kid = rows.find((r) => r.mumin_id === "m-kid");
    expect(kid?.attending).toBe(false);
  });

  it("keeps head + kid when adults=1, kids=1", async () => {
    await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: true, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
      { adults: 1, kids: 1 },
    );
    const rows = upsertedRows[0];
    const head = rows.find((r) => r.mumin_id === "m-head");
    const spouse = rows.find((r) => r.mumin_id === "m-spouse");
    const kid = rows.find((r) => r.mumin_id === "m-kid");
    expect(head?.attending).toBe(true);
    expect(spouse?.attending).toBe(false);
    expect(kid?.attending).toBe(true);
  });

  it("clamps inflated counts to actual family size and reports the cap", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: true, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
      { adults: 6, kids: 5 },
    );
    const rows = upsertedRows[0];
    // All 3 members should be attending — 6 clamped to 2 adults, 5 clamped to 1 kid
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.attending === true)).toBe(true);
    // The cap is reported back so the agent can tell the user.
    expect(result.clamped).toEqual({ requestedAdults: 6, requestedKids: 5, maxAdults: 2, maxKids: 1 });
  });

  it("does not report a clamp when counts fit within the family", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: true, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
      { adults: 1, kids: 0 },
    );
    expect(result.clamped).toBeUndefined();
  });

  it("does not apply partial counts to attending=false events", async () => {
    await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: false, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
      { adults: 1, kids: 0 },
    );
    const rows = upsertedRows[0];
    // All members should be not-attending (partial only applies to yes events).
    expect(rows.every((r) => r.attending === false)).toBe(true);
  });
});
