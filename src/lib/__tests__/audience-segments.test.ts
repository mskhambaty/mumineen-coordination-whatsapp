import { beforeEach, describe, expect, it, vi } from "vitest";

// Flexible Supabase mock: every query builder method is chainable and resolves to the rows we've
// stashed for that table, ignoring filters (resolveAudience applies its own logic on top).
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
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        gte: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: state[table] ?? [], error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

import { resolveAudience, segmentCounts } from "@/lib/whatsapp/audience";

beforeEach(() => {
  state.mumineen = [];
  state.families = [];
  state.unregistered_rsvps = [];
  state.niyaz_rsvp = [];
  state.niyaz_family_headcount = [];
  state.conversation_sessions = [];
});

describe("segment_all_users", () => {
  it("unions roster members with unregistered RSVP phones, deduped", async () => {
    state.mumineen = [{ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", not_attending: false, roster_active: true }];
    state.unregistered_rsvps = [{ phone_e164: "+13125559999" }, { phone_e164: "+13125559999" }]; // dup collapses
    const r = await resolveAudience("segment_all_users");
    expect(new Set(r.map((x) => x.phone))).toEqual(new Set(["+13125550001", "+13125559999"]));
  });

  it("dedupes an unregistered phone that is also a roster member", async () => {
    state.mumineen = [{ id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", not_attending: false, roster_active: true }];
    state.unregistered_rsvps = [{ phone_e164: "+13125550001" }];
    const r = await resolveAudience("segment_all_users");
    expect(r).toHaveLength(1);
  });
});

describe("segment_hof_unresponded", () => {
  const families = [{ id: "f1" }, { id: "f2" }];
  const members = [
    { id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true, not_attending: false, arrival_at: null },
    { id: "m2", family_id: "f2", whatsapp_e164: "+13125550002", is_head: true, not_attending: false, arrival_at: null },
  ];

  it("excludes families with a recorded RSVP response", async () => {
    state.families = families;
    state.mumineen = members;
    state.niyaz_rsvp = [{ family_id: "f1" }]; // f1 responded → dropped
    const r = await resolveAudience("segment_hof_unresponded");
    expect(r.map((x) => x.familyId)).toEqual(["f2"]);
  });

  it("excludes families with a head-count response", async () => {
    state.families = families;
    state.mumineen = members;
    state.niyaz_family_headcount = [{ family_id: "f2" }]; // f2 responded via head count → dropped
    const r = await resolveAudience("segment_hof_unresponded");
    expect(r.map((x) => x.familyId)).toEqual(["f1"]);
  });
});

describe("segmentCounts", () => {
  it("splits each segment into messaged-≤24h (free) vs needs-template (paid)", async () => {
    state.mumineen = [
      { id: "m1", family_id: "f1", whatsapp_e164: "+13125550001", is_head: true, not_attending: false, roster_active: true, arrival_at: null },
      { id: "m2", family_id: "f2", whatsapp_e164: "+13125550002", is_head: true, not_attending: false, roster_active: true, arrival_at: null },
    ];
    state.families = [{ id: "f1" }, { id: "f2" }];
    state.unregistered_rsvps = [{ phone_e164: "+13125559999" }];
    state.conversation_sessions = [{ phone_e164: "+13125550001" }]; // only m1 is in-window

    const counts = await segmentCounts();
    const all = counts.find((c) => c.key === "segment_all_users")!;
    expect(all.total).toBe(3); // m1, m2, unregistered
    expect(all.in_window).toBe(1); // m1
    expect(all.out_window).toBe(2);
  });
});
