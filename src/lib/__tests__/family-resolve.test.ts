import { beforeEach, describe, expect, it, vi } from "vitest";

// Per-test results keyed by table; the mock builder reads from here.
let results: Record<string, unknown> = {};

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(results[table] ?? { data: null }),
    then: (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { resolveFamilyForPhone } from "@/lib/rsvp/family";

beforeEach(() => {
  results = {};
});

describe("resolveFamilyForPhone", () => {
  it("resolves via mumin_phone_links when a link exists", async () => {
    results.mumin_phone_links = { data: { mumin_id: "m-1" } };
    results.mumineen = { data: { id: "m-1", family_id: "fam-1", hof_its: "40433372", full_name: "Fakhruddin", roster_active: true } };

    const fam = await resolveFamilyForPhone("+18478480128");
    expect(fam).toEqual({ familyId: "fam-1", muminId: "m-1", hofIts: "40433372", displayName: "Fakhruddin" });
  });

  // Regression: ~800 submitted members had a whatsapp_e164 on their roster row but NO
  // mumin_phone_links entry, so they were wrongly treated as unregistered when messaging the bot.
  // With no link, resolution must fall back to matching the member's own WhatsApp number.
  it("falls back to mumineen.whatsapp_e164 when there is no phone link", async () => {
    results.mumin_phone_links = { data: null }; // no link
    results.mumineen = {
      data: [
        { id: "m-2", family_id: "fam-2", hof_its: "40433372", full_name: "Taher", is_head: false },
        { id: "m-1", family_id: "fam-2", hof_its: "40433372", full_name: "Fakhruddin", is_head: true },
      ],
    };

    const fam = await resolveFamilyForPhone("+18478480128");
    // Prefers the head of family for a shared number.
    expect(fam).toEqual({ familyId: "fam-2", muminId: "m-1", hofIts: "40433372", displayName: "Fakhruddin" });
  });

  it("returns null when the number matches neither a link nor any roster WhatsApp number", async () => {
    results.mumin_phone_links = { data: null };
    results.mumineen = { data: [] };

    expect(await resolveFamilyForPhone("+10000000000")).toBeNull();
  });
});
