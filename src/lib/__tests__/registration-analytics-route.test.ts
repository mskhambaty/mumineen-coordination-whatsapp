import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { GET } from "@/app/api/admin/registration-analytics/route";

// Chainable stub: mumineen/families use .select(...).eq(...).range(from,to); departments uses
// .select(...).order(...).then(...). fetchAll asks for range(0,999) then stops on a short page.
function makeChain(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: rows }),
    range: (from: number) => Promise.resolve({ data: from === 0 ? rows : [] }),
  };
  return chain;
}

function stubSupabase(tables: Record<string, unknown[]>) {
  return { from: (table: string) => makeChain(tables[table] ?? []) };
}

function member(its: string, hof_its: string) {
  return {
    its,
    full_name: `Member ${its}`,
    hof_its,
    gender: "M",
    age: 30,
    is_adult: true,
    is_head: its === hof_its,
    local_mehman: "Mehman",
    arrival_at: null,
    departure_at: null,
    arrival_flight_no: null,
    airport: null,
    not_attending: false,
    rahat_seating: false,
    wheelchair: false,
    special_needs: null,
    wants_khidmat: null,
    khidmat_department_ids: null,
    whatsapp_e164: null,
    email: null,
  };
}

function family(hof_its: string, registration_status: string) {
  return {
    hof_its,
    registration_status,
    acc_type: null,
    hotel_name: null,
    open_to_utaro: null,
    transport_mode: null,
    submitted_at: null,
    utaro_host_name: null,
    utaro_host_its: null,
  };
}

// 2 registered families (3 members) + 3 not_started families (4 members) = 7 members.
const FAMILIES = [
  family("S1", "submitted"),
  family("S2", "submitted"),
  family("P1", "not_started"),
  family("P2", "not_started"),
  family("P3", "not_started"),
];
const MUMINEEN = [
  member("S1", "S1"),
  member("S1b", "S1"),
  member("S2", "S2"),
  member("P1", "P1"),
  member("P1b", "P1"),
  member("P2", "P2"),
  member("P3", "P3"),
];

function req(query = "") {
  return new NextRequest(`http://localhost/api/admin/registration-analytics${query ? `?${query}` : ""}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseAdmin.mockReturnValue(stubSupabase({ families: FAMILIES, mumineen: MUMINEEN, departments: [] }));
  requirePortalCaller.mockResolvedValue({ role: "admin" });
});

describe("GET /api/admin/registration-analytics — funnel counts", () => {
  it("partitions mumineen into registered vs pending under the All filter", async () => {
    const { summary } = await (await GET(req())).json();
    expect(summary.total_mumineen).toBe(7);
    expect(summary.submitted_mumineen).toBe(3);
    expect(summary.pending_mumineen).toBe(4);
    expect(summary.submitted_families).toBe(2);
    expect(summary.pending_families).toBe(3);
  });

  it("does NOT count members of filtered-out registered families as pending under the Pending filter", async () => {
    // Regression: pending_mumineen used to be `total - submitted`, which ballooned to the whole
    // roster (7) once the status filter removed the registered families from famStatusMap.
    const { summary } = await (await GET(req("status=pending"))).json();
    expect(summary.pending_mumineen).toBe(4);
    expect(summary.submitted_mumineen).toBe(0);
    expect(summary.pending_families).toBe(3);
    expect(summary.submitted_families).toBe(0);
  });

  it("shows zero pending mumineen under the Submitted filter", async () => {
    const { summary } = await (await GET(req("status=submitted"))).json();
    expect(summary.submitted_mumineen).toBe(3);
    expect(summary.pending_mumineen).toBe(0);
    expect(summary.submitted_families).toBe(2);
  });

  it("returns the auth response when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
