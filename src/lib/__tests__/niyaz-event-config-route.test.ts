import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getEvents = vi.fn();
const getEventConfig = vi.fn();
const upsertEventConfig = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEvents: (...a: unknown[]) => getEvents(...a) }));
vi.mock("@/lib/rsvp/event-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rsvp/event-config")>("@/lib/rsvp/event-config");
  return {
    eventConfigPatchSchema: actual.eventConfigPatchSchema,
    getEventConfig: (...a: unknown[]) => getEventConfig(...a),
    upsertEventConfig: (...a: unknown[]) => upsertEventConfig(...a),
  };
});

import { GET, PUT } from "@/app/api/admin/niyaz/instances/[id]/config/route";

const params = Promise.resolve({ id: "e1" });

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/niyaz/instances/e1/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getEvents.mockResolvedValue([{ id: "e1", eventDate: "2026-06-16" }]);
});

describe("PUT /api/admin/niyaz/instances/[id]/config", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await PUT(putReq({ rsvp_event_title: "2nd Moharram" }), { params });
    expect(res.status).toBe(403);
    expect(upsertEventConfig).not.toHaveBeenCalled();
  });

  it("upserts the day-level config for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    upsertEventConfig.mockResolvedValue({ eventDate: "2026-06-16", rsvpEventTitle: "2nd Moharram", lunchMenu: "Dal", dinnerMenu: "Biryani", rsvpEndTime: "10pm", hasLunch: true, hasDinner: true, templateCode: "ashara_relay_double_rsvp" });
    const res = await PUT(putReq({ rsvp_event_title: "2nd Moharram", has_lunch: true, has_dinner: true, template_code: "ashara_relay_double_rsvp" }), { params });
    expect(res.status).toBe(200);
    expect(upsertEventConfig).toHaveBeenCalledWith("2026-06-16", { rsvp_event_title: "2nd Moharram", has_lunch: true, has_dinner: true, template_code: "ashara_relay_double_rsvp" });
    const json = await res.json();
    expect(json.config).toMatchObject({ rsvpEventTitle: "2nd Moharram", hasLunch: true });
  });
});

describe("GET /api/admin/niyaz/instances/[id]/config", () => {
  it("returns the day's config for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    getEventConfig.mockResolvedValue({ eventDate: "2026-06-16", rsvpEventTitle: "2nd Moharram", lunchMenu: null, dinnerMenu: null, rsvpEndTime: null, hasLunch: false, hasDinner: false, templateCode: null });
    const res = await GET(new NextRequest("http://localhost/api/admin/niyaz/instances/e1/config"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.date).toBe("2026-06-16");
    expect(json.config).toMatchObject({ rsvpEventTitle: "2nd Moharram" });
  });
});
