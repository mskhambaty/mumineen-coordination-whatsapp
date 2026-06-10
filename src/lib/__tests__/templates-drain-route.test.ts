import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const drainUntilEmpty = vi.fn<(...a: unknown[]) => Promise<{ processed: number; batches: number }>>(
  async () => ({ processed: 0, batches: 1 }),
);

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/broadcast", () => ({ drainUntilEmpty: (...a: unknown[]) => drainUntilEmpty(...a) }));

import { POST as drainPost } from "@/app/api/admin/templates/drain/route";

function req(): NextRequest {
  return new NextRequest("http://localhost/x", { method: "POST" });
}

beforeEach(() => vi.clearAllMocks());

describe("drain route auth + behavior", () => {
  it("denies a non admin/leadership caller (403) and does not drain", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await drainPost(req());
    expect(res.status).toBe(403);
    expect(drainUntilEmpty).not.toHaveBeenCalled();
  });

  it("drains and returns the processed/batch counts for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    drainUntilEmpty.mockResolvedValue({ processed: 5, batches: 2 });
    const res = await drainPost(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, processed: 5, batches: 2 });
    expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
  });
});
