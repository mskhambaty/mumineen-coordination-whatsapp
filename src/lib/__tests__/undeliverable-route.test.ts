import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const listSuppressed = vi.fn();
const clearUndeliverable = vi.fn();

let people: { whatsapp_e164: string; full_name?: string; its?: string }[] = [];
const norm = (s: string) => {
  const d = s.replace(/[^\d]/g, "");
  return d ? `+${d}` : s;
};

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
// Stub the audience module so the route test doesn't pull the heavy audience/template graph.
vi.mock("@/lib/whatsapp/audience", () => ({
  normalizePhone: (s: string) => norm(s),
  resolveRosterByPhone: async () => new Map(people.map((p) => [norm(p.whatsapp_e164), p])),
}));
vi.mock("@/lib/whatsapp/undeliverable", () => ({
  listSuppressed: (...a: unknown[]) => listSuppressed(...a),
  clearUndeliverable: (...a: unknown[]) => clearUndeliverable(...a),
}));

import { DELETE, GET } from "@/app/api/admin/whatsapp/undeliverable/route";

const getReq = () => new NextRequest("http://localhost/api/admin/whatsapp/undeliverable");
const delReq = (qs = "?phone=%2B13125550001") => new NextRequest(`http://localhost/api/admin/whatsapp/undeliverable${qs}`, { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  people = [];
});

describe("undeliverable route — GET", () => {
  it("denies a non admin/leadership caller (403) and returns no numbers payload", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect((await res.json()).numbers).toBeUndefined();
    expect(listSuppressed).not.toHaveBeenCalled();
  });

  it("lists suppressed numbers with resolved identity for an admin", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    listSuppressed.mockResolvedValue([
      { phone_e164: "+13125550001", fail_count: 2, last_error_code: 131026, first_failed_at: "t0", last_failed_at: "t1", suppressed_at: "t1" },
      { phone_e164: "+13125559999", fail_count: 3, last_error_code: 131026, first_failed_at: "t0", last_failed_at: "t2", suppressed_at: "t2" },
    ]);
    people = [{ whatsapp_e164: "+13125550001", full_name: "Test Person", its: "12345678" }];

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numbers).toHaveLength(2);
    expect(json.numbers[0]).toMatchObject({ phone: "+13125550001", name: "Test Person", its: "12345678", fail_count: 2 });
    // Unmatched phone → null identity.
    expect(json.numbers[1]).toMatchObject({ phone: "+13125559999", name: null, its: null });
  });
});

describe("undeliverable route — DELETE (un-flag)", () => {
  it("denies a non admin/leadership caller (403) and never clears", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await DELETE(delReq());
    expect(res.status).toBe(403);
    expect(clearUndeliverable).not.toHaveBeenCalled();
  });

  it("400s when no phone is provided", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await DELETE(delReq(""));
    expect(res.status).toBe(400);
    expect(clearUndeliverable).not.toHaveBeenCalled();
  });

  it("clears a suppressed number and reports success", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    clearUndeliverable.mockResolvedValue(true);
    const res = await DELETE(delReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cleared: true, phone: "+13125550001" });
    expect(clearUndeliverable).toHaveBeenCalledWith("+13125550001", "u1");
  });

  it("404s when the number isn't on the suppression list", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    clearUndeliverable.mockResolvedValue(false);
    const res = await DELETE(delReq());
    expect(res.status).toBe(404);
  });
});
