import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

// The niyaz_event_family_grid RPC rows; the route pages them via fetchAllRows and returns `families`.
let familyRows: unknown[] = [];

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true }));
// Chainable rpc().order().range() — range is the terminal call fetchAllRows awaits.
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({
      order: () => ({ range: () => Promise.resolve({ data: familyRows, error: null }) }),
    }),
  }),
}));

import { GET } from "@/app/api/admin/niyaz/instances/[id]/families/route";

const params = Promise.resolve({ id: "e1" });
const req = () => new NextRequest("http://localhost/api/admin/niyaz/instances/e1/families");

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue(allow());
  familyRows = [
    { family_id: "f1", hof_its: "10000001", hof_name: "Husain bhai", responded: true, attending: 2, guests: 1, responded_at: "2026-06-17T19:00:00Z", responded_by: "+1999" },
    { family_id: "f2", hof_its: "10000002", hof_name: "Zainab bai", responded: false, attending: 0, guests: 0, responded_at: null, responded_by: null },
  ];
});

describe("GET niyaz families", () => {
  it("denies a non-portal caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
  });

  it("returns the per-family grid rows from the aggregate", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.families).toHaveLength(2);
    expect(body.families[0]).toMatchObject({ hof_name: "Husain bhai", responded: true, attending: 2, guests: 1 });
    expect(body.families[1]).toMatchObject({ hof_name: "Zainab bai", responded: false });
  });
});
