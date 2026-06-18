import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getEventTallies = vi.fn();
const getFamilyHeadCounts = vi.fn(async () => []);

// Per-table fake rows for the chainable supabase query builder.
const tableData: Record<string, { data: unknown[]; error: unknown }> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.order = () => b;
  // .range() is the terminal call the route awaits.
  b.range = () => Promise.resolve(tableData[table] ?? { data: [], error: null });
  return b;
}

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true }));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({
  getEventTallies: (...a: unknown[]) => getEventTallies(...a),
  getFamilyHeadCounts: (...a: unknown[]) => getFamilyHeadCounts(...a),
}));
// The breakdown RPC rows the route assembles into body.breakdown.
let breakdownRows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => builder(t),
    rpc: () => Promise.resolve({ data: breakdownRows, error: null }),
  }),
}));

import { GET } from "@/app/api/admin/niyaz/instances/[id]/responses/route";

const params = Promise.resolve({ id: "e1" });

function req(mode?: string): NextRequest {
  const qs = mode ? `?mode=${mode}` : "";
  return new NextRequest(`http://localhost/api/admin/niyaz/instances/e1/responses${qs}`);
}

// A tally with 1445 yes (1400 adults + 45 kids) and 384 no — the real DB aggregate.
const tally = (id: string) => ({
  id,
  title: "4th Moharram ul Haram",
  eventDate: "2026-06-18",
  hijriDate: "4 Muharram al-Haram 1448H",
  meal: "lunch",
  servingType: "thaal",
  description: null,
  yesAdults: 1400,
  yesKids: 45,
  yesFamilies: 500,
  thaalCount: 181,
  noAdults: 300,
  noKids: 84,
  noFamilies: 200,
  unregAdults: 0,
  unregKids: 0,
  headcountHeads: 0,
  rsvpCount: 1445,
});

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue(allow());
  getFamilyHeadCounts.mockResolvedValue([]);
  // Simulate the 1000-row cap: the fetched list is far smaller than the true aggregate.
  tableData["niyaz_rsvp"] = {
    data: [
      { id: "r1", mumin_id: "m1", family_id: "f1", attending: true, source: "whatsapp", responded_by_phone: null, recorded_by: null, updated_at: "2026-06-17T00:00:00Z", mumin: null, family: null },
      { id: "r2", mumin_id: "m2", family_id: "f1", attending: false, source: "whatsapp", responded_by_phone: null, recorded_by: null, updated_at: "2026-06-17T00:00:00Z", mumin: null, family: null },
    ],
    error: null,
  };
  tableData["unregistered_rsvps"] = { data: [], error: null };
  // Breakdown aggregate (DB-side, not row-capped): local 834/336 + mehman 589/251 + guest 88/96 = 1511/683.
  breakdownRows = [
    { grp: "local", yes_min: 834, no_min: 336, yes_adults_min: 700, yes_kids_min: 134, no_adults_min: 280, no_kids_min: 56, yes_max: 1188, no_max: 384, yes_adults_max: 1000, yes_kids_max: 188, no_adults_max: 300, no_kids_max: 84, responded: 1170, not_responded: 402 },
    { grp: "mehman", yes_min: 589, no_min: 251, yes_adults_min: 511, yes_kids_min: 78, no_adults_min: 203, no_kids_min: 48, yes_max: 945, no_max: 521, yes_adults_max: 807, yes_kids_max: 138, no_adults_max: 412, no_kids_max: 109, responded: 840, not_responded: 626 },
    { grp: "guest", yes_min: 88, no_min: 96, yes_adults_min: 88, yes_kids_min: 0, no_adults_min: 96, no_kids_min: 0, yes_max: 88, no_max: 96, yes_adults_max: 88, yes_kids_max: 0, no_adults_max: 96, no_kids_max: 0, responded: 184, not_responded: 0 },
  ];
});

describe("GET niyaz responses", () => {
  it("denies a non-portal caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req("min"), { params });
    expect(res.status).toBe(403);
    expect(getEventTallies).not.toHaveBeenCalled();
  });

  it("derives Yes/No from the aggregate tally, not the (capped) fetched rows", async () => {
    getEventTallies.mockResolvedValue([tally("e1")]);
    const res = await GET(req("min"), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Aggregate says 1445/384 even though only 2 rows (1 yes, 1 no) were fetched.
    expect(body.tally.yes).toBe(1445);
    expect(body.tally.no).toBe(384);
    expect(body.tally.mode).toBe("min");
    expect(body.responses).toHaveLength(2);
    expect(body.instance).toMatchObject({ id: "e1", title: "4th Moharram ul Haram", meal: "lunch" });
  });

  it("returns a member breakdown from the DB aggregate (guests separated), not the capped rows", async () => {
    getEventTallies.mockResolvedValue([tally("e1")]);
    const res = await GET(req("min"), { params });
    const body = await res.json();
    // Only 2 rows were fetched, but the breakdown reflects the full-event aggregate.
    expect(body.breakdown.total).toMatchObject({ yes: 1511, no: 683, responded: 2194, notResponded: 1028 });
    // Members are clean — guest placeholders are their own group, not folded into Local.
    expect(body.breakdown.local).toMatchObject({ yes: 834, no: 336 });
    expect(body.breakdown.mehman).toMatchObject({ yes: 589, no: 251 });
    expect(body.breakdown.guest).toMatchObject({ yes: 88, no: 96 });
    expect(body.breakdown.local.yes + body.breakdown.mehman.yes + body.breakdown.guest.yes).toBe(body.breakdown.total.yes);
  });

  it("threads the mode through to getEventTallies (defaulting to min)", async () => {
    getEventTallies.mockResolvedValue([tally("e1")]);
    await GET(req("max"), { params });
    expect(getEventTallies).toHaveBeenCalledWith("max");

    getEventTallies.mockClear();
    await GET(req(), { params });
    expect(getEventTallies).toHaveBeenCalledWith("min");
  });

  it("404s when the event has no tally (unknown id)", async () => {
    getEventTallies.mockResolvedValue([tally("other")]);
    const res = await GET(req("min"), { params });
    expect(res.status).toBe(404);
  });
});
