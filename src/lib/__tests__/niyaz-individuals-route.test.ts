import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

// The niyaz_event_individual_grid RPC rows; the route pages them via fetchAllRows and returns `individuals`.
let individualRows: unknown[] = [];

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true }));
// Chainable rpc().order().range() — range is the terminal call fetchAllRows awaits.
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({
      order: () => ({ range: () => Promise.resolve({ data: individualRows, error: null }) }),
    }),
  }),
}));

import { GET } from "@/app/api/admin/niyaz/instances/[id]/individuals/route";

const params = Promise.resolve({ id: "e1" });
const req = () => new NextRequest("http://localhost/api/admin/niyaz/instances/e1/individuals");

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue(allow());
  individualRows = [
    // A member who confirmed via WhatsApp.
    {
      mumin_id: "m1",
      its: "10000001",
      full_name: "Husain bhai",
      is_adult: null,
      local_mehman: null,
      hof_its: "10000001",
      whatsapp: "+1999",
      attending: true,
      source: "whatsapp",
      responded_by: "+1999",
      updated_at: "2026-06-17T19:00:00Z",
      responded: true,
    },
    // An eligible member who never got a niyaz_rsvp row → the regression case the old view dropped.
    {
      mumin_id: "m2",
      its: "10000002",
      full_name: "Zainab bai",
      is_adult: false,
      local_mehman: "Mehman",
      hof_its: "10000002",
      whatsapp: null,
      attending: null,
      source: null,
      responded_by: null,
      updated_at: null,
      responded: false,
    },
  ];
});

describe("GET niyaz individuals", () => {
  it("denies a non-portal caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
  });

  it("returns the per-member grid rows, including never-responded members", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.individuals).toHaveLength(2);
    expect(body.individuals[0]).toMatchObject({ full_name: "Husain bhai", responded: true, attending: true, source: "whatsapp" });
    // The non-responder is present with responded:false and null rsvp fields — what made the count wrong before.
    expect(body.individuals[1]).toMatchObject({ full_name: "Zainab bai", responded: false, attending: null, source: null });
  });
});
