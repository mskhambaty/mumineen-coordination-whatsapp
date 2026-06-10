import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase admin client so resolveRosterByPhone runs without env/DB. The direct
// mumineen lookup returns one roster row; mumin_phone_links returns nothing (no fallback).
const state = vi.hoisted(() => ({ mumineen: [] as unknown[], links: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === "mumineen" ? state.mumineen : table === "mumin_phone_links" ? state.links : [], error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

import { enrichFieldsByPhone } from "@/lib/whatsapp/audience";

beforeEach(() => {
  state.mumineen = [];
  state.links = [];
});

describe("enrichFieldsByPhone", () => {
  it("fills a blank Name from the roster while keeping CSV-provided values", async () => {
    state.mumineen = [
      { id: "m1", whatsapp_e164: "+13125550001", full_name: "Roster Name", its: "roster-its", jamaat: "Chicago", city: "Chicago", gender: "M", local_mehman: "Local" },
    ];
    const recips = [
      // Blank name (like a failures CSV), but a CSV-provided ITS that must win.
      { phone: "+13125550001", familyId: null, fields: { full_name: null, its: "csv-its" } },
    ];

    await enrichFieldsByPhone(recips);

    expect(recips[0].fields?.full_name).toBe("Roster Name"); // filled from roster
    expect(recips[0].fields?.its).toBe("csv-its"); // CSV value wins over roster
    expect(recips[0].fields?.jamaat).toBe("Chicago"); // other roster fields filled too
    expect(recips[0].muminId).toBe("m1");
  });

  it("leaves recipients with no roster match unchanged (still blank → template will skip them)", async () => {
    state.mumineen = []; // no match for this number
    const recips = [{ phone: "+19998887777", familyId: null, fields: { full_name: null } }];

    await enrichFieldsByPhone(recips);

    expect(recips[0].fields?.full_name).toBeNull();
    expect(recips[0].muminId).toBeUndefined();
  });

  it("does not query when every recipient already has all fields", async () => {
    state.mumineen = [{ id: "should-not-be-used", whatsapp_e164: "+13125550001", full_name: "X" }];
    // A recipient whose mappable fields are all populated → not in the 'need' set.
    const full: Record<string, string> = {
      full_name: "Given", its: "1", hof_its: "2", jamaat: "J", idara: "I", category: "C", venue: "V", city: "Y", gender: "M", local_mehman: "L", airport: "A",
    };
    const recips = [{ phone: "+13125550001", familyId: null, fields: { ...full } }];

    await enrichFieldsByPhone(recips);

    expect(recips[0].fields?.full_name).toBe("Given"); // untouched
    expect(recips[0].muminId).toBeUndefined();
  });
});
