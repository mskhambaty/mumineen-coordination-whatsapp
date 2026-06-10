import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture every upsert into unregistered_rsvps so we can assert the exact rows written.
let upsertCalls: { rows: Record<string, unknown>[]; opts: unknown }[] = [];

// Canonical events: two days, lunch + dinner each. Note the hijri night-first titling
// (a dinner is titled one Moharram number higher than the lunch on the same Gregorian day).
const EVENTS = [
  { id: "e-15-lunch", title: "1st Moharram ul Haram", event_date: "2026-06-15", hijri_date: null, meal: "lunch", serving_type: "thaal", description: null },
  { id: "e-15-dinner", title: "2nd Moharram ul Haram", event_date: "2026-06-15", hijri_date: null, meal: "dinner", serving_type: "packet", description: null },
  { id: "e-16-lunch", title: "2nd Moharram ul Haram", event_date: "2026-06-16", hijri_date: null, meal: "lunch", serving_type: "thaal", description: null },
  { id: "e-16-dinner", title: "3rd Moharram ul Haram", event_date: "2026-06-16", hijri_date: null, meal: "dinner", serving_type: "packet", description: null },
];

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    not: () => builder,
    order: () => builder,
    eq: () => builder,
    upsert: (rows: Record<string, unknown>[], opts: unknown) => {
      upsertCalls.push({ rows, opts });
      return Promise.resolve({ error: null });
    },
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) =>
      table === "rsvp_registration_instance" ? makeBuilder({ data: EVENTS }) : makeBuilder({ data: null }),
  }),
}));

import { recordUnregisteredRsvp } from "@/lib/rsvp/meal-rsvp";

const PHONE = "+19094509886";

beforeEach(() => {
  upsertCalls = [];
});

describe("recordUnregisteredRsvp", () => {
  // Regression: an unregistered caller saying "2 adults, all days except no dinner on 2nd Moharram
  // and no lunch on 1st Moharram" must record EVERY event (not just the exceptions), keep adults=2 on
  // all of them, and store the meal-specific exceptions as attending:false (the old code flipped a
  // meal-scoped "not attending" to attending:true and dropped the all-days baseline entirely).
  it("records the full grid from a baseline + exceptions with the right attendance and head count", async () => {
    const { upserted } = await recordUnregisteredRsvp({
      phone: PHONE,
      entries: [
        { attending: true, all: true },
        { attending: false, dates: ["2026-06-15"], meal: "lunch" },
        { attending: false, dates: ["2026-06-15"], meal: "dinner" },
      ],
      adults: 2,
      itsNumber: "30711842",
    });

    expect(upserted).toBe(4);
    expect(upsertCalls).toHaveLength(1);
    const rows = upsertCalls[0].rows;
    const byId = Object.fromEntries(rows.map((r) => [r.registration_instance_id, r]));

    // The two named exceptions are NOT attending; the other two stay attending.
    expect(byId["e-15-lunch"].attending).toBe(false);
    expect(byId["e-15-dinner"].attending).toBe(false);
    expect(byId["e-16-lunch"].attending).toBe(true);
    expect(byId["e-16-dinner"].attending).toBe(true);

    // Head count + ITS are written on every row, not defaulted to 1 / null.
    for (const r of rows) {
      expect(r.adults).toBe(2);
      expect(r.its_number).toBe("30711842");
      expect(r.phone_e164).toBe(PHONE);
    }
  });

  it("omits adults/kids/its_number when not provided so a later partial update can't clobber them", async () => {
    await recordUnregisteredRsvp({
      phone: PHONE,
      entries: [{ attending: false, dates: ["2026-06-16"], meal: "dinner" }],
    });

    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0].rows[0];
    expect(row.attending).toBe(false);
    expect(row).not.toHaveProperty("adults");
    expect(row).not.toHaveProperty("kids");
    expect(row).not.toHaveProperty("its_number");
  });
});
