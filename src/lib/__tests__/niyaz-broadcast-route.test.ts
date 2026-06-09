import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getEvents = vi.fn();
const resolveNiyazAudience = vi.fn();
const buildNiyazSend = vi.fn();
const createHeadCountPrompts = vi.fn(async () => undefined);
const createBroadcast = vi.fn();
const resolveApprovedTemplate = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true, isAdminOrLeadership: () => true }));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEvents: (...a: unknown[]) => getEvents(...a) }));
vi.mock("@/lib/rsvp/niyaz-prompt", () => ({
  resolveNiyazAudience: (...a: unknown[]) => resolveNiyazAudience(...a),
  buildNiyazSend: (...a: unknown[]) => buildNiyazSend(...a),
  createHeadCountPrompts: (...a: unknown[]) => createHeadCountPrompts(...a),
}));
vi.mock("@/lib/whatsapp/broadcast", () => ({ createBroadcast: (...a: unknown[]) => createBroadcast(...a) }));
vi.mock("@/lib/whatsapp/send-template", () => ({ resolveApprovedTemplate: (...a: unknown[]) => resolveApprovedTemplate(...a) }));

import { GET, POST } from "@/app/api/admin/niyaz/instances/[id]/broadcast/route";

const params = Promise.resolve({ id: "e1" });

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/niyaz/instances/e1/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getEvents.mockResolvedValue([{ id: "e1", title: "Lunch — Jun 16", eventDate: "2026-06-16", meal: "lunch", servingType: "thaal", description: null }]);
  buildNiyazSend.mockResolvedValue({ dayLabel: "Tue, Jun 16", mealLabel: "lunch & dinner", quickReplyButtons: [{ index: 0, payload: "niyaz|ind|both|2026-06-16" }] });
  resolveApprovedTemplate.mockResolvedValue({ name: "niyaz_rsvp", language: "en_US", bodyVars: ["name", "day", "meal"], header: null, headerVar: null, urlButtons: [] });
});

const validBody = { audience: "all_adults", level: "ind", only_non_responders: true, template_code: "niyaz_rsvp" };

describe("POST niyaz broadcast", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await POST(postReq(validBody), { params });
    expect(res.status).toBe(403);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("returns 400 when no recipients match", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({ recipients: [], unresolvedIts: [] });
    const res = await POST(postReq(validBody), { params });
    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("creates a broadcast with recipients + payloads + field/static bindings", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({ recipients: [{ phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Test" } }], unresolvedIts: [] });
    createBroadcast.mockResolvedValue({ broadcastId: "b1", total: 1, free: 0, paid: 1, skipped: 0, estCostUsd: 0 });
    const res = await POST(postReq(validBody), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("started");
    expect(createBroadcast).toHaveBeenCalledTimes(1);
    const arg = createBroadcast.mock.calls[0][0] as {
      recipients: unknown[];
      quickReplyButtons: unknown[];
      variableBindings: { body: Record<string, { kind: string; field?: string; value?: string }> };
    };
    expect(arg.recipients).toHaveLength(1);
    expect(arg.quickReplyButtons).toHaveLength(1);
    expect(arg.variableBindings.body.name).toEqual({ kind: "field", field: "full_name" });
    expect(arg.variableBindings.body.day.kind).toBe("static");
    expect(arg.variableBindings.body.meal.value).toBe("lunch & dinner");
    expect(arg.quickReplyButtons).toHaveLength(1); // buttons mode keeps payloads
    expect(createHeadCountPrompts).not.toHaveBeenCalled();
  });

  it("head-count mode: no quick-reply payloads, logs prompts, binds family_members/message/example", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveApprovedTemplate.mockResolvedValue({ name: "niyaz_rsvp_family_count", language: "en_US", bodyVars: ["person_name", "registration_message", "family_members", "example_response"], header: null, headerVar: null, urlButtons: [] });
    resolveNiyazAudience.mockResolvedValue({ recipients: [{ phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Test", family_members: "A, B" } }], unresolvedIts: [] });
    createBroadcast.mockResolvedValue({ broadcastId: "b2", total: 1, free: 0, paid: 1, skipped: 0, estCostUsd: 0 });
    const res = await POST(postReq({ audience: "all_hof", level: "fam", template_code: "niyaz_rsvp_family_count", mode: "headcount" }), { params });
    expect(res.status).toBe(200);
    const arg = createBroadcast.mock.calls[0][0] as {
      quickReplyButtons?: unknown;
      variableBindings: { body: Record<string, { kind: string; field?: string; value?: string }> };
    };
    expect(arg.quickReplyButtons).toBeUndefined();
    expect(arg.variableBindings.body.person_name).toEqual({ kind: "field", field: "full_name" });
    expect(arg.variableBindings.body.family_members).toEqual({ kind: "field", field: "family_members" });
    expect(arg.variableBindings.body.registration_message.kind).toBe("static");
    expect(arg.variableBindings.body.example_response.value).toBe("4");
    expect(createHeadCountPrompts).toHaveBeenCalledTimes(1);
  });
});

describe("GET niyaz broadcast (count preview)", () => {
  it("returns the recipient count for the chosen audience", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({ recipients: [{ phone: "+1", familyId: "f1", muminId: "m1" }, { phone: "+2", familyId: "f2", muminId: "m2" }], unresolvedIts: ["999"] });
    const res = await GET(new NextRequest("http://localhost/api/admin/niyaz/instances/e1/broadcast?audience=all_hof&level=fam&only_non_responders=false"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    expect(json.unresolved_its).toEqual(["999"]);
  });
});
