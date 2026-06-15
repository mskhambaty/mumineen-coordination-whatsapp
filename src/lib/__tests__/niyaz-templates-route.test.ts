import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const listMessageTemplates = vi.fn();
const getBroadcastAccount = vi.fn();
const getPrimaryAccount = vi.fn(() => ({ label: "primary", phoneNumberId: "PN", accessToken: "t" }));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true }));
vi.mock("@/lib/meta/whatsapp", () => ({ listMessageTemplates: (...a: unknown[]) => listMessageTemplates(...a) }));
vi.mock("@/lib/whatsapp/accounts", () => ({
  getBroadcastAccount: (...a: unknown[]) => getBroadcastAccount(...a),
  getPrimaryAccount: (...a: unknown[]) => getPrimaryAccount(...a),
}));

import { GET } from "@/app/api/admin/niyaz/templates/route";

const req = () => new NextRequest("http://localhost/api/admin/niyaz/templates", { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  getBroadcastAccount.mockReturnValue({ label: "broadcast", phoneNumberId: "PN_B", accessToken: "tb", wabaId: "WABA_B", displayNumber: "+16307638963" });
});

describe("GET /api/admin/niyaz/templates", () => {
  it("denies an unauthorized caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(listMessageTemplates).not.toHaveBeenCalled();
  });

  it("returns approved templates from the broadcast (630) account, sorted", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    listMessageTemplates.mockResolvedValue([
      { name: "zz_old", language: "en_US", status: "APPROVED" },
      { name: "ashara_relay_double_rsvp", language: "en_US", status: "APPROVED" },
      { name: "draft_one", language: "en_US", status: "PENDING" },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    // Only APPROVED, sorted by name, from the broadcast account.
    expect(json.templates).toEqual([
      { name: "ashara_relay_double_rsvp", language: "en_US" },
      { name: "zz_old", language: "en_US" },
    ]);
    expect(json.account).toBe("+16307638963");
    expect(listMessageTemplates).toHaveBeenCalledWith(expect.objectContaining({ label: "broadcast" }));
  });

  it("returns an empty list with an error when Meta lookup fails", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    listMessageTemplates.mockRejectedValue(new Error("Meta down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templates).toEqual([]);
    expect(json.error).toBe("Meta down");
  });
});
