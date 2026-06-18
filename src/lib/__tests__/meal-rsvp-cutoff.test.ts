import { describe, expect, it, vi, beforeEach } from "vitest";

// A one-person family.
const FAMILY_MEMBERS = [{ id: "m-head", not_attending: false, is_adult: true, is_head: true }];

// Two days, dinner each: Jun 21 (RSVP closed) and Jun 22 (RSVP open).
const EVENTS = [
  { id: "e-21-dinner", title: "8th Moharram ul Haram", event_date: "2026-06-21", hijri_date: null, meal: "dinner", serving_type: "thaal", description: null },
  { id: "e-22-dinner", title: "9th Moharram ul Haram", event_date: "2026-06-22", hijri_date: null, meal: "dinner", serving_type: "thaal", description: null },
];

// Jun 21 cutoff is in the past (closed); Jun 22 cutoff is far future (open).
const CONFIG = [
  { event_date: "2026-06-21", rsvp_end_at: "2020-01-01T00:00:00.000Z", rsvp_event_title: "8th Moharram ul Haram" },
  { event_date: "2026-06-22", rsvp_end_at: "2999-01-01T00:00:00.000Z", rsvp_event_title: "9th Moharram ul Haram" },
];

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
      if (table === "niyaz_event_config") return makeBuilder({ data: CONFIG });
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

describe("setFamilyNiyazRsvp RSVP cutoff", () => {
  it("does NOT write a change to a day whose RSVP cutoff has passed, and reports it blocked", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: false, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
    );
    // Nothing should have been upserted for the closed day.
    expect(upsertedRows).toHaveLength(0);
    expect(result.updated).toBe(0);
    expect(result.blocked).toEqual([
      { date: "2026-06-21", title: "8th Moharram ul Haram", endAt: "2020-01-01T00:00:00.000Z" },
    ]);
  });

  it("writes a change to an open day and reports nothing blocked", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: false, dates: ["2026-06-22"], meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
    );
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0].every((r) => r.registration_instance_id === "e-22-dinner")).toBe(true);
    expect(result.blocked).toBeUndefined();
  });

  it("only writes the open day when one entry spans a closed and an open day", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: false, all: true, meal: "dinner" as const }],
      { source: "whatsapp", phone: "+15551234567" },
    );
    // The closed Jun 21 dinner is dropped; only Jun 22 is written.
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0].every((r) => r.registration_instance_id === "e-22-dinner")).toBe(true);
    expect(result.blocked).toEqual([
      { date: "2026-06-21", title: "8th Moharram ul Haram", endAt: "2020-01-01T00:00:00.000Z" },
    ]);
  });

  it("blocks even an admin-sourced write past the cutoff (no bypass — nobody can change a closed day)", async () => {
    const result = await setFamilyNiyazRsvp(
      "fam-1",
      [{ attending: false, dates: ["2026-06-21"], meal: "dinner" as const }],
      { source: "admin", recordedBy: "staff-1" },
    );
    expect(upsertedRows).toHaveLength(0);
    expect(result.updated).toBe(0);
    expect(result.blocked).toEqual([
      { date: "2026-06-21", title: "8th Moharram ul Haram", endAt: "2020-01-01T00:00:00.000Z" },
    ]);
  });
});
