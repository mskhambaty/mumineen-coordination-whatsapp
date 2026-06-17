import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test: the `all_adults` and `all_hof` niyaz audiences include all LOCAL members
// regardless of registration, but only MEHMAN members whose family registration is `submitted`.
// Before this rule, the composer sent require_registered=false and so reached every attending
// member regardless of registration — mehman-not_started rows would (wrongly) be included.

const getSupabaseAdmin = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => getSupabaseAdmin() }));
// getEvents is only hit for onlyNonResponders; stub it so the import is satisfied.
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEvents: vi.fn(async () => []) }));

import { resolveNiyazAudience } from "@/lib/rsvp/niyaz-prompt";

type Row = Record<string, unknown>;

// Chainable, range-paged Supabase fake. The all_adults / all_hof main query has NO .in(), so it
// returns the full member set from .range(). attachFamilyFields issues an .in("family_id", …)
// lookup — routed to those families' members. Filters other than .in() are ignored; the resolver
// applies the local-vs-mehman rule itself in TS.
function makeSupabase(members: Row[]) {
  function builder() {
    const state: { inField: string; inValues: string[] } = { inField: "", inValues: [] };
    const b: Record<string, unknown> = {
      from: () => b,
      select: () => b,
      eq: () => b,
      not: () => b,
      order: () => b,
      in: (field: string, values: string[]) => {
        state.inField = field;
        state.inValues = values;
        return b;
      },
      range: (from: number, to: number) => {
        let rows: Row[] = [];
        if (state.inField === "") rows = members; // main audience query (no .in())
        else if (state.inField === "family_id") rows = members.filter((m) => state.inValues.includes(m.family_id as string));
        return Promise.resolve({ data: rows.slice(from, to + 1) });
      },
    };
    return b;
  }
  return { from: () => builder() };
}

function member(i: number, local_mehman: string, registration_status: string, extra: Row = {}): Row {
  return {
    id: `m${i}`,
    family_id: `f${i}`,
    whatsapp_e164: `+1312555${String(i).padStart(4, "0")}`,
    is_head: true,
    is_adult: true,
    not_attending: false,
    full_name: `Person ${i}`,
    age: 40,
    local_mehman,
    families: { roster_active: true, registration_status },
    ...extra,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveNiyazAudience local-vs-mehman registration rule", () => {
  it("all_adults: includes all locals, only submitted mehman", async () => {
    const members = [
      member(0, "Local", "not_started"), // included
      member(1, "Local", "submitted"), // included
      member(2, "Mehman", "submitted"), // included
      member(3, "Mehman", "not_started"), // EXCLUDED
    ];
    getSupabaseAdmin.mockReturnValue(makeSupabase(members));

    const { recipients } = await resolveNiyazAudience({ date: "2026-06-16", audience: "all_adults", level: "ind", requireRegistered: false });

    expect(recipients.map((r) => r.muminId).sort()).toEqual(["m0", "m1", "m2"]);
    expect(recipients.find((r) => r.muminId === "m3")).toBeUndefined();
  });

  it("all_hof: drops an unsubmitted-mehman family but keeps an unsubmitted-local family", async () => {
    const members = [
      member(0, "Local", "not_started"), // family kept, rep = head
      member(1, "Mehman", "not_started"), // family EXCLUDED
    ];
    getSupabaseAdmin.mockReturnValue(makeSupabase(members));

    const { recipients } = await resolveNiyazAudience({ date: "2026-06-16", audience: "all_hof", level: "fam", requireRegistered: false });

    expect(recipients.map((r) => r.muminId)).toEqual(["m0"]);
  });
});
