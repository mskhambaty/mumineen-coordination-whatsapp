import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFamilyForPhone = vi.fn();
const passEq = vi.fn();
const lotIn = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "parking_passes") return { select: () => ({ eq: passEq }) };
  if (table === "parking_lots") return { select: () => ({ in: lotIn }) };
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/rsvp/family", () => ({
  resolveFamilyForPhone: (...args: unknown[]) => resolveFamilyForPhone(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from }),
}));

import { GET } from "@/app/api/parking/my-passes/route";

const PHONE = "+15551234567";
const FAMILY = { familyId: "fam-1", muminId: "m-1", hofIts: "20342679", displayName: "Turab Bhaijeewala" };

function req(withPhone = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withPhone) headers["x-whatsapp-from"] = PHONE;
  return new NextRequest("http://localhost/api/parking/my-passes", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/parking/my-passes", () => {
  it("rejects a request with no x-whatsapp-from header (unauthorized)", async () => {
    const res = await GET(req(false));
    expect(res.status).toBe(400);
    expect(resolveFamilyForPhone).not.toHaveBeenCalled();
  });

  it("returns the caller's own family's passes with per-color entry guidance", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    passEq.mockResolvedValue({
      data: [
        { id: "p1", printed_at: null, lot_id: "lot-red" },
        { id: "p2", printed_at: null, lot_id: "lot-gold" },
      ],
      error: null,
    });
    lotIn.mockResolvedValue({
      data: [
        { id: "lot-red", name: "TCP 1 (Hillside Ln)", color: "red" },
        { id: "lot-gold", name: "VIP (Ezzy)", color: "gold" },
      ],
      error: null,
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();

    // Scoped to the caller's own phone — never an ITS from the request.
    expect(resolveFamilyForPhone).toHaveBeenCalledWith(PHONE);
    expect(json.status).toBe("ok");
    expect(json.head_name).toBe("Turab Bhaijeewala");
    expect(json.general_access).toMatch(/Route 83/);
    expect(json.rideshare_dropoff).toMatch(/Wat Buddha/);
    expect(json.passes).toHaveLength(2);

    const red = json.passes.find((p: { color: string }) => p.color === "red");
    expect(red.entry).toMatch(/Hillside Lane/);
    expect(red.purpose).toBeNull();

    const gold = json.passes.find((p: { color: string }) => p.color === "gold");
    expect(gold.purpose).toMatch(/wheelchair/i);
    expect(gold.entry).toMatch(/10S280 Kingery/);
  });

  it("returns no_passes when the family has no allocated pass", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    passEq.mockResolvedValue({ data: [], error: null });

    const res = await GET(req());
    const json = await res.json();
    expect(json.status).toBe("no_passes");
    expect(json.passes).toEqual([]);
    // No lot lookup when there are no passes.
    expect(lotIn).not.toHaveBeenCalled();
  });

  it("returns unregistered (no lookup) when the number isn't linked to a family", async () => {
    resolveFamilyForPhone.mockResolvedValue(null);
    const res = await GET(req());
    const json = await res.json();
    expect(json.status).toBe("unregistered");
    expect(json.general_access).toMatch(/Route 83/);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces a 500 when the pass query errors", async () => {
    resolveFamilyForPhone.mockResolvedValue(FAMILY);
    passEq.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
