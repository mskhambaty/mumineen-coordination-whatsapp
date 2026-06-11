import { beforeEach, describe, expect, it, vi } from "vitest";

// Flexible Supabase mock: every query builder method is chainable and resolves to the rows we've
// stashed for that table, ignoring filters (resolveAudience applies its own logic on top). Supports
// both awaited queries (.then) and paginated reads (.range, via fetchAllRows). NB: the mock ignores
// the registration_status filter, so `state.families` should contain exactly the registered families.
const state = vi.hoisted(() => ({
  mumineen: [] as unknown[],
  families: [] as unknown[],
  unregistered_rsvps: [] as unknown[],
  niyaz_rsvp: [] as unknown[],
  niyaz_family_headcount: [] as unknown[],
  conversation_sessions: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: keyof typeof state) => {
      const result = () => ({ data: state[table] ?? [], error: null });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        gte: () => builder,
        order: () => builder,
        range: () => Promise.resolve(result()),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));

import { registeredMemberRecipients, resolveAudience, segmentCounts } from "@/lib/whatsapp/audience";

beforeEach(() => {
  state.mumineen = [];
  state.families = [];
  state.unregistered_rsvps = [];
  state.niyaz_rsvp = [];
  state.niyaz_family_headcount = [];
  state.conversation_sessions = [];
});

const member = (over: Record<string, unknown>) => ({
  id: "m", family_id: "f", whatsapp_e164: "+10000000000", is_head: false, arrival_at: null, not_attending: false, ...over,
});

describe("registeredMemberRecipients (registration-scoped)", () => {
  it("includes members of registered families, excludes unregistered-family members", async () => {
    state.families = [{ id: "f1" }]; // only f1 is registered
    state.mumineen = [
      member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001" }),
      member({ id: "m2", family_id: "f2", whatsapp_e164: "+13125550002" }), // not a registered family
    ];
    const r = await registeredMemberRecipients();
    expect(r.map((x) => x.phone)).toEqual(["+13125550001"]);
  });
});

describe("segment_all_users", () => {
  it("unions registered members with unregistered RSVP phones, deduped", async () => {
    state.families = [{ id: "f1" }];
    state.mumineen = [member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true })];
    state.unregistered_rsvps = [{ phone_e164: "+13125559999" }, { phone_e164: "+13125559999" }]; // dup collapses
    const r = await resolveAudience("segment_all_users");
    expect(new Set(r.map((x) => x.phone))).toEqual(new Set(["+13125550001", "+13125559999"]));
  });

  it("excludes members of unregistered families", async () => {
    state.families = [{ id: "f1" }]; // f2 not registered
    state.mumineen = [
      member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001" }),
      member({ id: "m2", family_id: "f2", whatsapp_e164: "+13125550002" }),
    ];
    const r = await resolveAudience("segment_all_users");
    expect(r.map((x) => x.phone)).toEqual(["+13125550001"]);
  });
});

describe("segment_hof (registered HOF)", () => {
  it("returns one head per registered family ∪ unregistered, excluding unregistered families", async () => {
    state.families = [{ id: "f1" }]; // only f1 registered
    state.mumineen = [
      member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true }),
      member({ id: "m1b", family_id: "f1", whatsapp_e164: "+13125550009", is_head: false }), // same family
      member({ id: "m2", family_id: "f2", whatsapp_e164: "+13125550002", is_head: true }), // unregistered family
    ];
    state.unregistered_rsvps = [{ phone_e164: "+13125559999" }];
    const r = await resolveAudience("segment_hof");
    expect(new Set(r.map((x) => x.phone))).toEqual(new Set(["+13125550001", "+13125559999"]));
  });
});

describe("segment_hof_unresponded", () => {
  beforeEach(() => {
    state.families = [{ id: "f1" }, { id: "f2" }];
    state.mumineen = [
      member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true }),
      member({ id: "m2", family_id: "f2", whatsapp_e164: "+13125550002", is_head: true }),
    ];
  });

  it("excludes families with a recorded RSVP response", async () => {
    state.niyaz_rsvp = [{ family_id: "f1" }]; // f1 responded → dropped
    const r = await resolveAudience("segment_hof_unresponded");
    expect(r.map((x) => x.familyId)).toEqual(["f2"]);
  });

  it("excludes families with a head-count response", async () => {
    state.niyaz_family_headcount = [{ family_id: "f2" }]; // f2 responded via head count → dropped
    const r = await resolveAudience("segment_hof_unresponded");
    expect(r.map((x) => x.familyId)).toEqual(["f1"]);
  });
});

describe("segmentCounts", () => {
  it("splits each segment into messaged-≤24h (free) vs needs-template (paid)", async () => {
    state.families = [{ id: "f1" }, { id: "f2" }];
    state.mumineen = [
      member({ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true }),
      member({ id: "m2", family_id: "f2", whatsapp_e164: "+13125550002", is_head: true }),
    ];
    state.unregistered_rsvps = [{ phone_e164: "+13125559999" }];
    state.conversation_sessions = [{ phone_e164: "+13125550001" }]; // only m1 is in-window

    const counts = await segmentCounts();
    const all = counts.find((c) => c.key === "segment_all_users")!;
    expect(all.total).toBe(3); // m1, m2, unregistered
    expect(all.in_window).toBe(1); // m1
    expect(all.out_window).toBe(2);
  });
});
