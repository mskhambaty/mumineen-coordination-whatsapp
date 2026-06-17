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
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));

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
