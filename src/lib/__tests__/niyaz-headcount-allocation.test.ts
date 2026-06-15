import { describe, expect, it, vi, beforeEach } from "vitest";

// A family of 5: head (adult), two other adults, two kids.
const FAMILY_MEMBERS = [
  { id: "m-head", not_attending: false, is_adult: true, is_head: true },
  { id: "m-adult2", not_attending: false, is_adult: true, is_head: false },
  { id: "m-adult3", not_attending: false, is_adult: true, is_head: false },
  { id: "m-kid1", not_attending: false, is_adult: false, is_head: false },
  { id: "m-kid2", not_attending: false, is_adult: false, is_head: false },
];

// One day (Jun 14) with both a lunch and a dinner — a head count applies to every event that day.
const EVENTS = [
  { id: "e-14-lunch", title: "Pehli Raat", event_date: "2026-06-14", hijri_date: null, meal: "lunch", serving_type: "thaal", description: null },
  { id: "e-14-dinner", title: "Pehli Raat", event_date: "2026-06-14", hijri_date: null, meal: "dinner", serving_type: "thaal", description: null },
];

const niyazRsvpUpserts: Record<string, unknown>[][] = [];
const headcountUpserts: Record<string, unknown>[][] = [];

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
          select: () => makeBuilder({ data: [] }), // getFamilyNiyazGrid read
          upsert: (rows: Record<string, unknown>[]) => {
            niyazRsvpUpserts.push(rows);
            return { error: null };
          },
        };
      }
      if (table === "niyaz_family_headcount") {
        return {
          upsert: (rows: Record<string, unknown>[]) => {
            headcountUpserts.push(rows);
            return { error: null };
          },
        };
      }
      return makeBuilder({ data: [] });
    },
  }),
}));

import { recordFamilyHeadCount } from "@/lib/rsvp/meal-rsvp";

const attendingOf = (id: string) =>
  niyazRsvpUpserts.flat().filter((r) => r.mumin_id === id).map((r) => r.attending);

beforeEach(() => {
  niyazRsvpUpserts.length = 0;
  headcountUpserts.length = 0;
});

describe("recordFamilyHeadCount → niyaz_rsvp allocation (single source of truth)", () => {
  it("allocates a head count of 3 across the family in priority order (head → adults → kids)", async () => {
    await recordFamilyHeadCount("fam-1", "2026-06-14", 3, "+15551234567");

    // Per day there are 2 events (lunch + dinner); the same 3 members attend each.
    expect(attendingOf("m-head")).toEqual([true, true]);
    expect(attendingOf("m-adult2")).toEqual([true, true]);
    expect(attendingOf("m-adult3")).toEqual([true, true]);
    // Kids fall outside the first 3 → not attending.
    expect(attendingOf("m-kid1")).toEqual([false, false]);
    expect(attendingOf("m-kid2")).toEqual([false, false]);
  });

  it("clamps a head count above the roster to the family size and reports the cap", async () => {
    const result = await recordFamilyHeadCount("fam-1", "2026-06-14", 7, "+15551234567");

    // All 5 members attending — 7 clamped to 5.
    for (const m of ["m-head", "m-adult2", "m-adult3", "m-kid1", "m-kid2"]) {
      expect(attendingOf(m)).toEqual([true, true]);
    }
    expect(result.clamped?.requestedTotal).toBe(7);
    expect(result.clamped?.maxTotal).toBe(5);
  });

  it("does not report a clamp when the count fits the family", async () => {
    const result = await recordFamilyHeadCount("fam-1", "2026-06-14", 4, "+15551234567");
    expect(result.clamped).toBeUndefined();
  });

  it("also records the raw reply in niyaz_family_headcount (audit), one row per event that day", async () => {
    await recordFamilyHeadCount("fam-1", "2026-06-14", 3, "+15551234567");
    const rows = headcountUpserts.flat();
    expect(rows).toHaveLength(2); // lunch + dinner
    expect(rows.every((r) => r.head_count === 3)).toBe(true);
    expect(rows.map((r) => r.registration_instance_id).sort()).toEqual(["e-14-dinner", "e-14-lunch"]);
  });
});
