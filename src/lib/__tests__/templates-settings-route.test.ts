import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const upsertTemplateSetting = vi.fn();
const segmentCounts = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/template-settings", () => ({
  upsertTemplateSetting: (...a: unknown[]) => upsertTemplateSetting(...a),
}));
vi.mock("@/lib/whatsapp/audience", () => ({
  segmentCounts: (...a: unknown[]) => segmentCounts(...a),
  // Mirror the real resolver: any positive override wins (no upper cap), else the env default (24).
  resolveWindowHours: (h?: number | null) =>
    typeof h === "number" && Number.isFinite(h) && h > 0 ? h : 24,
}));

import { PUT as settingsPut } from "@/app/api/admin/templates/settings/route";
import { GET as segmentsGet } from "@/app/api/admin/templates/segments/route";

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(): NextRequest {
  return new NextRequest("http://localhost/x", { method: "GET" });
}

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/admin/templates/settings", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await settingsPut(jsonReq({ template_name: "t", is_active: false }));
    expect(res.status).toBe(403);
    expect(upsertTemplateSetting).not.toHaveBeenCalled();
  });

  it("rejects a body with no fields to update (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await settingsPut(jsonReq({ template_name: "t" }));
    expect(res.status).toBe(400);
    expect(upsertTemplateSetting).not.toHaveBeenCalled();
  });

  it("saves friendly name + active flag for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    upsertTemplateSetting.mockResolvedValue({ friendlyName: "Daily RSVP", isActive: false });
    const res = await settingsPut(jsonReq({ template_name: "daily_niyaz", friendly_name: "Daily RSVP", is_active: false }));
    expect(res.status).toBe(200);
    expect(upsertTemplateSetting).toHaveBeenCalledWith("daily_niyaz", { friendlyName: "Daily RSVP", isActive: false });
    const json = await res.json();
    expect(json).toMatchObject({ template_name: "daily_niyaz", friendlyName: "Daily RSVP", isActive: false });
  });
});

describe("GET /api/admin/templates/segments", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await segmentsGet(getReq());
    expect(res.status).toBe(403);
    expect(segmentCounts).not.toHaveBeenCalled();
  });

  it("returns the segment counts for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    segmentCounts.mockResolvedValue([{ key: "segment_all_users", label: "All", total: 3, in_window: 1, out_window: 2 }]);
    const res = await segmentsGet(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segments).toHaveLength(1);
    expect(json.segments[0]).toMatchObject({ key: "segment_all_users", total: 3 });
    expect(json.window_hours).toBe(24);
  });

  it("honors an ?hours override and passes it to segmentCounts", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    segmentCounts.mockResolvedValue([]);
    const res = await segmentsGet(new NextRequest("http://localhost/x?hours=12", { method: "GET" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.window_hours).toBe(12);
    expect(segmentCounts).toHaveBeenCalledWith(12);
  });
});
