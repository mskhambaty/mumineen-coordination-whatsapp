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
const resolveApprovedTemplateForAnyAccount = vi.fn();
const getEventConfig = vi.fn();
const ACCOUNT = { label: "primary", phoneNumberId: "PN1", accessToken: "t", wabaId: "WABA1" };
// Wrap a bare descriptor in the { account, descriptor } shape the cross-account resolver returns.
const resolved = (descriptor: unknown) => ({ account: ACCOUNT, descriptor });

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true, isAdminOrLeadership: () => true }));
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEvents: (...a: unknown[]) => getEvents(...a) }));
vi.mock("@/lib/rsvp/niyaz-prompt", () => ({
  resolveNiyazAudience: (...a: unknown[]) => resolveNiyazAudience(...a),
  buildNiyazSend: (...a: unknown[]) => buildNiyazSend(...a),
  createHeadCountPrompts: (...a: unknown[]) => createHeadCountPrompts(...a),
}));
vi.mock("@/lib/whatsapp/broadcast", () => ({ createBroadcast: (...a: unknown[]) => createBroadcast(...a) }));
vi.mock("@/lib/whatsapp/send-template", () => ({ resolveApprovedTemplateForAnyAccount: (...a: unknown[]) => resolveApprovedTemplateForAnyAccount(...a) }));
vi.mock("@/lib/rsvp/event-config", () => ({ getEventConfig: (...a: unknown[]) => getEventConfig(...a) }));

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
  getEventConfig.mockResolvedValue(null);
  buildNiyazSend.mockResolvedValue({ dayLabel: "Tue, Jun 16", mealLabel: "lunch & dinner", quickReplyButtons: [{ index: 0, payload: "niyaz|ind|both|2026-06-16" }] });
  resolveApprovedTemplateForAnyAccount.mockResolvedValue(resolved({ name: "niyaz_rsvp", language: "en_US", bodyVars: ["name", "day", "meal"], header: null, headerVar: null, urlButtons: [] }));
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

  it("passes custom Flow + quick-reply button payloads (ashara double-RSVP) through variableBindings", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    getEventConfig.mockResolvedValue({
      eventDate: "2026-06-16",
      dayId: 2,
      rsvpEventTitle: "2nd Moharram",
      lunchMenu: "Dal Chawal",
      dinnerMenu: "Biryani",
      rsvpEndTime: "10pm",
      hasLunch: true,
      hasDinner: true,
      templateCode: "ashara_relay_double_rsvp",
    });
    resolveApprovedTemplateForAnyAccount.mockResolvedValue(
      resolved({ name: "ashara_relay_double_rsvp", language: "en_US", bodyVars: ["rsvp_event_title", "lunch_menu", "dinner_menu", "rsvp_end_time"], header: null, headerVar: null, urlButtons: [], flowButtons: [{ index: 0, text: "Attending" }] }),
    );
    resolveNiyazAudience.mockResolvedValue({ recipients: [{ phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Test", mumin_id: "m1", eligible_family_count: "4" } }], unresolvedIts: [] });
    createBroadcast.mockResolvedValue({ broadcastId: "b3", total: 1, free: 0, paid: 1, skipped: 0, estCostUsd: 0 });

    const body = {
      audience: "all_hof",
      level: "fam",
      require_registered: false,
      template_code: "ashara_relay_double_rsvp",
      buttons: [
        { type: "flow", index: 0, flow_token: "rsvp:{{Person.Id}}:{{RegistrationInstanceId}}", flow_action_data: { person_id: "{{Person.Id}}", registration_instance_id: "{{RegistrationInstanceId}}", attending_count: "{{EligibleFamilyCount}}" } },
        { type: "quick_reply", index: 1, payload: "not-attending-{{Person.Id}}-{{RegistrationInstanceId}}" },
      ],
    };
    const res = await POST(postReq(body), { params });
    expect(res.status).toBe(200);
    const arg = createBroadcast.mock.calls[0][0] as {
      quickReplyButtons?: unknown;
      variableBindings: { buttons: unknown[]; buttonTokens: Record<string, string>; body: Record<string, { kind: string; value?: string }> };
    };
    // Legacy quick-reply buttons are not sent when a custom spec is supplied.
    expect(arg.quickReplyButtons).toBeUndefined();
    expect(arg.variableBindings.buttons).toHaveLength(2);
    // {{RegistrationInstanceId}} resolves to the day's numeric day_id, not the instance UUID.
    expect(arg.variableBindings.buttonTokens).toEqual({ RegistrationInstanceId: "2" });
    // Event-config values bind as statics for the day.
    expect(arg.variableBindings.body.lunch_menu).toEqual({ kind: "static", value: "Dal Chawal" });
    expect(arg.variableBindings.body.dinner_menu).toEqual({ kind: "static", value: "Biryani" });
    expect(arg.variableBindings.body.rsvp_event_title).toEqual({ kind: "static", value: "2nd Moharram" });
    // require_registered=false reaches the audience resolver.
    expect(resolveNiyazAudience.mock.calls[0][0]).toMatchObject({ requireRegistered: false });
  });

  it("applies explicit variable_bindings over the auto-bound defaults", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({ recipients: [{ phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Test" } }], unresolvedIts: [] });
    createBroadcast.mockResolvedValue({ broadcastId: "b4", total: 1, free: 0, paid: 1, skipped: 0, estCostUsd: 0 });

    const body = {
      ...validBody,
      variable_bindings: { body: { day: { kind: "static", value: "CUSTOM DAY" }, name: { kind: "field", field: "its" } } },
    };
    const res = await POST(postReq(body), { params });
    expect(res.status).toBe(200);
    const arg = createBroadcast.mock.calls[0][0] as { variableBindings: { body: Record<string, { kind: string; field?: string; value?: string }> } };
    // Explicit overrides win…
    expect(arg.variableBindings.body.day).toEqual({ kind: "static", value: "CUSTOM DAY" });
    expect(arg.variableBindings.body.name).toEqual({ kind: "field", field: "its" });
    // …and an un-overridden token keeps its auto-bound default (meal → static mealLabel).
    expect(arg.variableBindings.body.meal).toEqual({ kind: "static", value: "lunch & dinner" });
  });

  it("head-count mode: no quick-reply payloads, logs prompts, binds family_members/message/example", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveApprovedTemplateForAnyAccount.mockResolvedValue(resolved({ name: "niyaz_rsvp_family_count", language: "en_US", bodyVars: ["person_name", "registration_message", "family_members", "example_response"], header: null, headerVar: null, urlButtons: [] }));
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

describe("GET niyaz broadcast (audience preview)", () => {
  it("returns the recipient count + a masked sample list for the chosen audience", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({
      recipients: [
        { phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Aliasger", its: "10000001" } },
        { phone: "+15557654321", familyId: "f2", muminId: "m2", fields: { full_name: "Fatema", its: "10000002" } },
      ],
      unresolvedIts: ["999"],
    });
    const res = await GET(new NextRequest("http://localhost/api/admin/niyaz/instances/e1/broadcast?audience=all_hof&level=fam&only_non_responders=false"), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    expect(json.unresolved_its).toEqual(["999"]);
    expect(json.sample).toHaveLength(2);
    expect(json.sample[0]).toEqual({ name: "Aliasger", its: "10000001", phone_masked: "••••4567" });
  });

  it("format=csv returns the full audience as a CSV download with UNMASKED phone numbers", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    resolveNiyazAudience.mockResolvedValue({
      recipients: [
        { phone: "+15551234567", familyId: "f1", muminId: "m1", fields: { full_name: "Aliasger", its: "10000001", hof_its: "10000001", jamaat: "Chicago", city: "Chicago", gender: "M", local_mehman: "Local" } },
        { phone: "+15557654321", familyId: "f2", muminId: "m2", fields: { full_name: 'Fatema "F"', its: "10000002" } },
      ],
      unresolvedIts: [],
    });
    const res = await GET(new NextRequest("http://localhost/api/admin/niyaz/instances/e1/broadcast?audience=all_hof&level=fam&format=csv"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="niyaz-audience-all_hof-2026-06-16.csv"');
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe('"Name","ITS","HOF ITS","Jamaat","City","Gender","Local/Mehman","WhatsApp"');
    // Full (unmasked) phone numbers, and quotes in a value are escaped by doubling.
    expect(lines[1]).toBe('"Aliasger","10000001","10000001","Chicago","Chicago","M","Local","+15551234567"');
    expect(lines[2]).toBe('"Fatema ""F""","10000002","","","","","","+15557654321"');
  });

  it("format=csv is gated to admin/leadership (403 for a non-authorized caller)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(new NextRequest("http://localhost/api/admin/niyaz/instances/e1/broadcast?audience=all_hof&level=fam&format=csv"), { params });
    expect(res.status).toBe(403);
    expect(resolveNiyazAudience).not.toHaveBeenCalled();
  });
});
