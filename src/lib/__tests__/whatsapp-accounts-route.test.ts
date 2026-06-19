import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getAccounts = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/accounts", () => ({
  getAccounts: (...a: unknown[]) => getAccounts(...a),
  accountDisplayName: (a: { displayName?: string; displayNumber?: string; label: string }) =>
    a.displayName ?? a.displayNumber ?? a.label,
}));

import { GET } from "@/app/api/admin/whatsapp/accounts/route";

const req = () => new Request("http://localhost/api/admin/whatsapp/accounts") as never;

beforeEach(() => {
  vi.clearAllMocks();
  getAccounts.mockReturnValue([
    {
      label: "primary",
      phoneNumberId: "PN1",
      displayName: "AI Bot",
      displayNumber: "+1630",
      // secrets that must NOT be exposed
      accessToken: "SECRET_TOKEN",
      appSecret: "SECRET_APP",
      verifyToken: "SECRET_VERIFY",
    },
    { label: "broadcast", phoneNumberId: "PN2", displayName: "Anjuman e Saifee", displayNumber: "+1872", accessToken: "T2" },
  ]);
});

describe("GET /api/admin/whatsapp/accounts", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("returns accounts with display labels and NO secret fields", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0]).toEqual({
      label: "primary",
      name: "AI Bot",
      displayName: "AI Bot",
      displayNumber: "+1630",
      phoneNumberId: "PN1",
    });
    // No secret leaks anywhere in the payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("SECRET_APP");
    expect(serialized).not.toContain("SECRET_VERIFY");
  });
});
