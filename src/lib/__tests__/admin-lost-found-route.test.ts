import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const orderedReports = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => requirePortalCaller(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        order: (...args: unknown[]) => orderedReports(...args),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/admin/lost-found/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/lost-found", () => {
  it("returns the portal guard response when unauthorized", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await GET(new NextRequest("http://localhost/api/admin/lost-found"));

    expect(response.status).toBe(401);
    expect(orderedReports).not.toHaveBeenCalled();
  });

  it("returns reports to an authorized portal member", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "user-1" } });
    orderedReports.mockResolvedValue({
      data: [{ id: "report-1", report_type: "lost", item_name: "Backpack" }],
      error: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/admin/lost-found"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reports).toHaveLength(1);
  });
});
