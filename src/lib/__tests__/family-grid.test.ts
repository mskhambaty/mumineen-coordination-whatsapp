import { describe, expect, it, vi } from "vitest";

// Canonical events: two days, lunch each (enough to exercise the adult/kid split).
const EVENTS = [
  { id: "e-15-lunch", title: "1st Moharram ul Haram", event_date: "2026-06-15", hijri_date: null, meal: "lunch", serving_type: "thaal", description: null },
  { id: "e-16-lunch", title: "2nd Moharram ul Haram", event_date: "2026-06-16", hijri_date: null, meal: "lunch", serving_type: "thaal", description: null },
];

// A family of 2 adults + 2 kids. On the 15th all four attend; on the 16th only the two adults do
// (the kids are marked not attending). One adult row carries is_adult=null to prove null⇒adult.
const RSVP_ROWS = [
  { registration_instance_id: "e-15-lunch", attending: true, mumineen: { is_adult: true } },
  { registration_instance_id: "e-15-lunch", attending: true, mumineen: { is_adult: null } },
  { registration_instance_id: "e-15-lunch", attending: true, mumineen: { is_adult: false } },
  { registration_instance_id: "e-15-lunch", attending: true, mumineen: { is_adult: false } },
  { registration_instance_id: "e-16-lunch", attending: true, mumineen: { is_adult: true } },
  { registration_instance_id: "e-16-lunch", attending: true, mumineen: { is_adult: true } },
  { registration_instance_id: "e-16-lunch", attending: false, mumineen: { is_adult: false } },
  { registration_instance_id: "e-16-lunch", attending: false, mumineen: { is_adult: false } },
];

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
    from: (table: string) =>
      table === "rsvp_registration_instance"
        ? makeBuilder({ data: EVENTS })
        : table === "niyaz_rsvp"
          ? makeBuilder({ data: RSVP_ROWS })
          : makeBuilder({ data: [] }),
  }),
}));

import { getFamilyNiyazGrid } from "@/lib/rsvp/meal-rsvp";

describe("getFamilyNiyazGrid adult/kid split", () => {
  // Regression: the grid used to return only a total, so the agent read back a 2-adult/2-kid family
  // as "4 adults". It must now split attending into adults (is_adult null|true) and kids (false).
  it("splits attending into adults and kids (null counts as adult)", async () => {
    const grid = await getFamilyNiyazGrid("fam-1");

    const day15 = grid.find((r) => r.event.id === "e-15-lunch")!;
    expect(day15.attending).toBe(4);
    expect(day15.adults).toBe(2); // is_adult true + is_adult null
    expect(day15.kids).toBe(2);
    expect(day15.total).toBe(4);

    const day16 = grid.find((r) => r.event.id === "e-16-lunch")!;
    expect(day16.attending).toBe(2);
    expect(day16.adults).toBe(2);
    expect(day16.kids).toBe(0); // the two kids are not attending
    expect(day16.total).toBe(4); // but still have rows
  });
});
