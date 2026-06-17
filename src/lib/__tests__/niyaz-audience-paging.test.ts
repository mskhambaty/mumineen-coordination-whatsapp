import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test: resolveNiyazAudience("all_adults_hof") must page through ALL matching rows, not
// silently truncate at PostgREST's 1000-row cap. A bare `await` (no .range()) returned only the
// first 1000 adults of a large HOF list; fetchAllRows windows the query in 1000-row pages.

const getSupabaseAdmin = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => getSupabaseAdmin() }));
// getEvents is only hit for onlyNonResponders; stub it so the import is satisfied.
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEvents: vi.fn(async () => []) }));

import { resolveNiyazAudience } from "@/lib/rsvp/niyaz-prompt";

type Row = Record<string, unknown>;

// Chainable, range-paged Supabase fake. Routes by the .in() column: a hof_its lookup returns the
// full member set (paged via .range()); a family_id lookup returns those families' members (for
// attachFamilyFields). Filters other than .in() are ignored — the resolver applies its own logic.
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
        if (state.inField === "hof_its") rows = members;
        else if (state.inField === "family_id") rows = members.filter((m) => state.inValues.includes(m.family_id as string));
        return Promise.resolve({ data: rows.slice(from, to + 1) });
      },
    };
    return b;
  }
  return { from: () => builder() };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveNiyazAudience all_adults_hof paging", () => {
  it("returns every matching adult past the 1000-row cap (no silent truncation)", async () => {
    // 1100 distinct adults (distinct phones + families) so neither dedupe nor the cap can mask a
    // truncation — a single-page read would yield 1000.
    const members: Row[] = Array.from({ length: 1100 }, (_, i) => ({
      id: `m${i}`,
      family_id: `f${i}`,
      whatsapp_e164: `+1312555${String(i).padStart(4, "0")}`,
      is_head: true,
      is_adult: true,
      not_attending: false,
      hof_its: "10000001",
      full_name: `Person ${i}`,
      age: 40,
    }));
    getSupabaseAdmin.mockReturnValue(makeSupabase(members));

    const { recipients } = await resolveNiyazAudience({
      date: "2026-06-16",
      audience: "all_adults_hof",
      its: ["10000001"],
      level: "ind",
    });

    expect(recipients).toHaveLength(1100);
    expect(new Set(recipients.map((r) => r.phone)).size).toBe(1100);
  });
});
