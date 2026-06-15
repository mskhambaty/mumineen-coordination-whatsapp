import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();
const getEventConfig = vi.fn();
const upsertEventConfig = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true, isAdminOrLeadership: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: (...a: unknown[]) => getSupabaseAdmin(...a) }));
vi.mock("@/lib/rsvp/event-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rsvp/event-config")>("@/lib/rsvp/event-config");
  return {
    eventConfigPatchSchema: actual.eventConfigPatchSchema,
    getEventConfig: (...a: unknown[]) => getEventConfig(...a),
    upsertEventConfig: (...a: unknown[]) => upsertEventConfig(...a),
  };
});

import { GET as listGet } from "@/app/api/admin/niyaz/days/route";
import { GET as dayGet, PUT as dayPut } from "@/app/api/admin/niyaz/days/[date]/route";

// Minimal chainable Supabase stub for the days list route.
function supabaseStub(days: unknown[], instances: unknown[]) {
  return {
    from: (table: string) => {
      if (table === "niyaz_event_config") {
        return { select: () => ({ order: () => Promise.resolve({ data: days }) }) };
      }
      return { select: () => ({ in: () => ({ order: () => Promise.resolve({ data: instances }) }) }) };
    },
  };
}

function getReq(url = "http://localhost/api/admin/niyaz/days"): NextRequest {
  return new NextRequest(url, { method: "GET" });
}
function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/niyaz/days/2026-06-16", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/niyaz/days", () => {
  it("denies an unauthorized caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await listGet(getReq());
    expect(res.status).toBe(403);
  });

  it("lists days with a representative instance id per date", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    getSupabaseAdmin.mockReturnValue(
      supabaseStub(
        [{ event_date: "2026-06-16", rsvp_event_title: "2nd Moharram ul Haram", lunch_menu: null, dinner_menu: null, rsvp_end_time: null, has_lunch: true, has_dinner: true, template_code: "ashara_relay_double_rsvp" }],
        [{ id: "inst-dinner", event_date: "2026-06-16", meal: "dinner" }, { id: "inst-lunch", event_date: "2026-06-16", meal: "lunch" }],
      ),
    );
    const res = await listGet(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.days).toHaveLength(1);
    // meal ascending → "dinner" sorts before "lunch", so the first instance is the representative.
    expect(json.days[0]).toMatchObject({ date: "2026-06-16", title: "2nd Moharram ul Haram", instance_id: "inst-dinner", has_lunch: true });
  });
});

describe("PUT /api/admin/niyaz/days/[date]", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await dayPut(putReq({ rsvp_event_title: "x" }), { params: Promise.resolve({ date: "2026-06-16" }) });
    expect(res.status).toBe(403);
    expect(upsertEventConfig).not.toHaveBeenCalled();
  });

  it("rejects an invalid date (400)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await dayPut(putReq({ rsvp_event_title: "x" }), { params: Promise.resolve({ date: "not-a-date" }) });
    expect(res.status).toBe(400);
    expect(upsertEventConfig).not.toHaveBeenCalled();
  });

  it("upserts the day config for an authorized caller", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    upsertEventConfig.mockResolvedValue({ eventDate: "2026-06-16", rsvpEventTitle: "2nd Moharram", lunchMenu: "Dal", dinnerMenu: null, rsvpEndTime: null, hasLunch: true, hasDinner: false, templateCode: null });
    const res = await dayPut(putReq({ rsvp_event_title: "2nd Moharram", lunch_menu: "Dal", has_lunch: true, has_dinner: false }), { params: Promise.resolve({ date: "2026-06-16" }) });
    expect(res.status).toBe(200);
    expect(upsertEventConfig).toHaveBeenCalledWith("2026-06-16", { rsvp_event_title: "2nd Moharram", lunch_menu: "Dal", has_lunch: true, has_dinner: false });
  });

  it("returns the day config on GET", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    getEventConfig.mockResolvedValue({ eventDate: "2026-06-16", rsvpEventTitle: "2nd Moharram", lunchMenu: null, dinnerMenu: null, rsvpEndTime: null, hasLunch: true, hasDinner: true, templateCode: null });
    const res = await dayGet(getReq("http://localhost/api/admin/niyaz/days/2026-06-16"), { params: Promise.resolve({ date: "2026-06-16" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ date: "2026-06-16", config: { rsvpEventTitle: "2nd Moharram" } });
  });
});
