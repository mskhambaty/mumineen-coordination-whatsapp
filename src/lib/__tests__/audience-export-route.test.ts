import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const previewAudience = vi.fn();
const previewExplicitRecipients = vi.fn();
const enrichFieldsByPhone = vi.fn(async () => {});
const parseAudienceCsv = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/audience", () => ({
  AUDIENCE_KEYS: ["selected_users", "all_members", "custom", "csv_upload"],
  WINDOW_FILTERS: ["all", "in_window", "out_window"],
  previewAudience: (...a: unknown[]) => previewAudience(...a),
  previewExplicitRecipients: (...a: unknown[]) => previewExplicitRecipients(...a),
  enrichFieldsByPhone: (...a: unknown[]) => enrichFieldsByPhone(...a),
}));
vi.mock("@/lib/whatsapp/audience-csv", () => ({ parseAudienceCsv: (...a: unknown[]) => parseAudienceCsv(...a) }));
vi.mock("@/lib/whatsapp/audience-filter", () => ({ validateRules: () => null }));

import { POST as exportPost } from "@/app/api/admin/templates/audience-export/route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("audience-export route", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await exportPost(req({ audience_key: "all_members" }));
    expect(res.status).toBe(403);
    expect(previewAudience).not.toHaveBeenCalled();
  });

  it("exports a resolved (DB) audience as CSV", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    previewAudience.mockResolvedValue({
      total: 1,
      in_window: 1,
      out_window: 0,
      est_cost_usd: 0,
      recipients: [{ phone: "+13125550001", inWindow: true, fields: { full_name: "A B", its: "10" } }],
    });
    const res = await exportPost(req({ audience_key: "all_members" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("A B");
    expect(text).toContain("+13125550001");
    expect(text).toContain("free");
    expect(parseAudienceCsv).not.toHaveBeenCalled();
  });

  it("rejects csv_upload with no csv (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await exportPost(req({ audience_key: "csv_upload" }));
    expect(res.status).toBe(400);
    expect(parseAudienceCsv).not.toHaveBeenCalled();
  });

  it("exports the resolved csv_upload audience (parsed → enriched → labelled)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    parseAudienceCsv.mockReturnValue({
      recipients: [{ phone: "+13125550002", fields: {} }],
      parsed: 1,
      skipped: 0,
      duplicates: 0,
      corrupted: 0,
    });
    previewExplicitRecipients.mockResolvedValue({
      total: 1,
      in_window: 0,
      out_window: 1,
      est_cost_usd: 0.04,
      // roster-enriched by enrichFieldsByPhone, then window-labelled
      recipients: [{ phone: "+13125550002", inWindow: false, fields: { full_name: "Cee Dee", its: "20" } }],
    });

    const res = await exportPost(req({ audience_key: "csv_upload", csv: "WhatsApp\n+13125550002" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(parseAudienceCsv).toHaveBeenCalledOnce();
    expect(enrichFieldsByPhone).toHaveBeenCalledOnce();
    expect(previewExplicitRecipients).toHaveBeenCalledOnce();
    expect(previewAudience).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).toContain("Cee Dee"); // enriched name present
    expect(text).toContain("+13125550002");
    expect(text).toContain("paid"); // out-of-window label
  });

  it("surfaces a CSV parse error (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    parseAudienceCsv.mockReturnValue({ recipients: [], parsed: 0, skipped: 0, duplicates: 0, corrupted: 0, error: "No WhatsApp column found." });
    const res = await exportPost(req({ audience_key: "csv_upload", csv: "Name\nA" }));
    expect(res.status).toBe(400);
    expect(enrichFieldsByPhone).not.toHaveBeenCalled();
  });
});
