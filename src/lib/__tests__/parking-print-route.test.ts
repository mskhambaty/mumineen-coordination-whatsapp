import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();

// Per-table query stubs. Each builder is a thenable that resolves to its preset result,
// so chained `.eq()/.in()/.order()` all return the same builder.
function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (b as any).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return b;
}

const tables: Record<string, unknown> = {};
const from = vi.fn((table: string) => {
  if (!(table in tables)) throw new Error(`unexpected table ${table}`);
  return builder(tables[table]);
});

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => requirePortalCaller(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from }),
}));

import { GET } from "@/app/api/admin/parking/print/route";

function req(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/admin/parking/print${query}`, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
});

describe("GET /api/admin/parking/print", () => {
  it("returns 401 when the caller lacks parking access", async () => {
    requirePortalCaller.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(req("?hof_its=20342679"));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes passes to a single household and returns its head name (all print statuses)", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "test" } });
    tables.families = { data: [{ id: "fam-1", hof_its: "20342679" }], error: null };
    tables.parking_lots = {
      data: [
        { id: "lot-red", name: "TCP 1", color: "red" },
        { id: "lot-gold", name: "VIP", color: "gold" },
      ],
      error: null,
    };
    tables.parking_passes = {
      data: [
        { id: "p1", family_id: "fam-1", lot_id: "lot-red", printed_at: "2026-06-01T00:00:00Z" },
        { id: "p2", family_id: "fam-1", lot_id: "lot-gold", printed_at: null },
      ],
      error: null,
    };
    tables.mumineen = {
      data: [{ hof_its: "20342679", full_name: "Turab Bhaijeewala", whatsapp_e164: "+15551234567", is_head: true }],
      error: null,
    };

    const res = await GET(req("?hof_its=20342679&unprinted_only=0"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.household).toEqual({ hof_its: "20342679", head_name: "Turab Bhaijeewala" });
    expect(json.passes).toHaveLength(2);
    // Sorted by lot name: TCP 1 before VIP.
    expect(json.passes.map((p: { lot_name: string }) => p.lot_name)).toEqual(["TCP 1", "VIP"]);
    expect(json.lot).toBeNull();
  });

  it("404s when the household ITS has no family", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "test" } });
    tables.families = { data: [], error: null };
    const res = await GET(req("?hof_its=00000000"));
    expect(res.status).toBe(404);
  });
});
