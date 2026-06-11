import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const previewAudience = vi.fn();
const createBroadcast = vi.fn();
const drainBroadcasts = vi.fn<(...a: unknown[]) => Promise<{ processed: number; broadcastsTouched: number }>>(
  async () => ({ processed: 0, broadcastsTouched: 0 }),
);

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/audience", () => ({
  AUDIENCE_KEYS: ["selected_users", "chicago_committee", "arrived_hof", "registered_hof", "all_members"],
  previewAudience: (...a: unknown[]) => previewAudience(...a),
}));
vi.mock("@/lib/whatsapp/broadcast", () => ({
  createBroadcast: (...a: unknown[]) => createBroadcast(...a),
  drainBroadcasts: (...a: unknown[]) => drainBroadcasts(...a),
}));
// Keep NextResponse/NextRequest real; stub only after().
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

import { POST as previewPost } from "@/app/api/admin/templates/preview/route";
import { POST as sendPost } from "@/app/api/admin/templates/send/route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("preview route auth + behavior", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await previewPost(req({ audience_key: "chicago_committee" }));
    expect(res.status).toBe(403);
    expect(previewAudience).not.toHaveBeenCalled();
  });

  it("rejects an invalid audience key (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await previewPost(req({ audience_key: "everyone" }));
    expect(res.status).toBe(400);
  });

  it("returns counts for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    previewAudience.mockResolvedValue({ total: 100, in_window: 40, out_window: 60, est_cost_usd: 3 });
    const res = await previewPost(req({ audience_key: "all_members" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ total: 100, in_window: 40, out_window: 60, est_cost_usd: 3 });
  });
});

describe("send route auth + behavior", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await sendPost(req({ template_code: "t", audience_key: "chicago_committee" }));
    expect(res.status).toBe(403);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("starts a broadcast for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    createBroadcast.mockResolvedValue({ broadcastId: "b1", total: 10, free: 4, paid: 6, estCostUsd: 0.3 });
    const res = await sendPost(req({ template_code: "daily_feedback_survey", audience_key: "chicago_committee" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("started");
    expect(json.broadcastId).toBe("b1");
  });

  it("surfaces a createBroadcast error (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    createBroadcast.mockResolvedValue({ error: "No recipients in the selected audience." });
    const res = await sendPost(req({ template_code: "t", audience_key: "selected_users" }));
    expect(res.status).toBe(400);
  });

  it("forwards the per-broadcast send throttle (batch_size / send_interval_ms)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    createBroadcast.mockResolvedValue({ broadcastId: "b1", total: 3, free: 0, paid: 3, skipped: 0, estCostUsd: 0 });
    const res = await sendPost(req({ template_code: "t", audience_key: "chicago_committee", batch_size: 3, send_interval_ms: 4000 }));
    expect(res.status).toBe(200);
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 3, sendIntervalMs: 4000 }));
  });

  it("rejects an out-of-range throttle (400) and does not create a broadcast", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await sendPost(req({ template_code: "t", audience_key: "chicago_committee", batch_size: 0 }));
    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });
});
