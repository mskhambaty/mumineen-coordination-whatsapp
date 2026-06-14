import { describe, expect, it, vi } from "vitest";

// One event. The family's attendance is already materialized into niyaz_rsvp (reflected by the
// tallies view/RPC as 3 attending). The raw head-count reply (3) is ALSO present in
// niyaz_family_headcount. The fix: getEventTallies must count the 3 once (from niyaz_rsvp), never
// add the head count on top — otherwise a family that texted "3" would tally as 6.
const EVENTS = [
  { id: "e1", title: "Pehli Raat", event_date: "2026-06-14", hijri_date: null, meal: "dinner", serving_type: "thaal", description: null },
];

const TALLY_ROW = {
  instance_id: "e1",
  yes_adults: 3,
  yes_kids: 0,
  yes_families: 1,
  thaal_count: 1,
  no_adults: 0,
  no_kids: 0,
  no_families: 0,
};

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
    rpc: () => makeBuilder({ data: [TALLY_ROW] }), // niyaz_event_tallies_min()
    from: (table: string) => {
      if (table === "rsvp_registration_instance") return makeBuilder({ data: EVENTS });
      if (table === "niyaz_event_tallies") return makeBuilder({ data: [TALLY_ROW] });
      if (table === "niyaz_family_headcount") return makeBuilder({ data: [{ registration_instance_id: "e1", head_count: 3 }] });
      if (table === "unregistered_rsvps") return makeBuilder({ data: [] });
      return makeBuilder({ data: [] });
    },
  }),
}));

import { getEventTallies } from "@/lib/rsvp/meal-rsvp";

describe("getEventTallies — head count is not double-counted", () => {
  it("counts attendance from niyaz_rsvp only (max mode); head count is display-only", async () => {
    const tallies = await getEventTallies("max");
    const e = tallies.find((t) => t.id === "e1")!;
    expect(e.rsvpCount).toBe(3); // not 3 + 3 = 6
    expect(e.headcountHeads).toBe(3); // still surfaced as the raw reply
    expect(e.thaalCount).toBe(1); // ceil(3/8)
  });

  it("counts attendance from niyaz_rsvp only (min mode)", async () => {
    const tallies = await getEventTallies("min");
    const e = tallies.find((t) => t.id === "e1")!;
    expect(e.rsvpCount).toBe(3);
  });
});
