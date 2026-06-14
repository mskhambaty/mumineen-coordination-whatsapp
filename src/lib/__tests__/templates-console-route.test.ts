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
  WINDOW_FILTERS: ["all", "in_window", "out_window"],
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

  it("forwards the window filter to previewAudience (defaulting to 'all')", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    previewAudience.mockResolvedValue({ total: 60, in_window: 0, out_window: 60, est_cost_usd: 3 });
    await previewPost(req({ audience_key: "all_members", window: "out_window" }));
    expect(previewAudience).toHaveBeenLastCalledWith("all_members", [], undefined, "out_window");

    await previewPost(req({ audience_key: "all_members" }));
    expect(previewAudience).toHaveBeenLastCalledWith("all_members", [], undefined, "all");
  });

  it("rejects an invalid window value (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await previewPost(req({ audience_key: "all_members", window: "yesterday" }));
    expect(res.status).toBe(400);
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

  it("passes the window filter into createBroadcast (defaulting to 'all')", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    createBroadcast.mockResolvedValue({ broadcastId: "b1", total: 6, free: 0, paid: 6, estCostUsd: 0.3 });
    await sendPost(req({ template_code: "t", audience_key: "all_members", window: "out_window" }));
    expect(createBroadcast).toHaveBeenLastCalledWith(expect.objectContaining({ windowFilter: "out_window" }));

    await sendPost(req({ template_code: "t", audience_key: "all_members" }));
    expect(createBroadcast).toHaveBeenLastCalledWith(expect.objectContaining({ windowFilter: "all" }));
  });
});
