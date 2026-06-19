import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const createBroadcast = vi.fn();
const drainUntilEmpty = vi.fn(async () => ({ processed: 0, batches: 1 }));
const getAccountByPhoneNumberId = vi.fn();

// Keep NextResponse/NextRequest real; stub `after` so the inline drain doesn't run outside a request.
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after: (fn: () => unknown) => { void fn; } };
});
vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/whatsapp/audience", () => ({
  AUDIENCE_KEYS: ["selected_users", "all_members", "custom", "csv_upload"] as const,
  WINDOW_FILTERS: ["all", "in_window", "out_window"] as const,
  enrichFieldsByPhone: vi.fn(),
}));
vi.mock("@/lib/whatsapp/audience-csv", () => ({ parseAudienceCsv: vi.fn() }));
vi.mock("@/lib/whatsapp/audience-filter", () => ({ validateRules: () => null }));
vi.mock("@/lib/whatsapp/broadcast", () => ({
  createBroadcast: (...a: unknown[]) => createBroadcast(...a),
  drainUntilEmpty: (...a: unknown[]) => drainUntilEmpty(...a),
}));
vi.mock("@/lib/whatsapp/accounts", () => ({ getAccountByPhoneNumberId: (...a: unknown[]) => getAccountByPhoneNumberId(...a) }));

import { POST } from "@/app/api/admin/templates/send/route";

const postReq = (body: unknown) =>
  new Request("http://localhost/api/admin/templates/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

const ACCOUNT = { label: "broadcast", phoneNumberId: "PN2", accessToken: "t", wabaId: "WABA2" };

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue(allow());
  createBroadcast.mockResolvedValue({ broadcastId: "b1", total: 3, free: 3, paid: 0, skipped: 0, estCostUsd: 0 });
  getAccountByPhoneNumberId.mockReturnValue(ACCOUNT);
});

describe("POST /api/admin/templates/send", () => {
  it("denies a non admin/leadership caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await POST(postReq({ template_code: "t", audience_key: "all_members" }));
    expect(res.status).toBe(403);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("rejects a template send without template_code (400)", async () => {
    const res = await POST(postReq({ message_kind: "template", audience_key: "all_members" }));
    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("rejects a free-text send without phone_number_id (400)", async () => {
    const res = await POST(postReq({ message_kind: "text", text: "Hi", audience_key: "all_members" }));
    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("rejects a free-text send without text (400)", async () => {
    const res = await POST(postReq({ message_kind: "text", phone_number_id: "PN2", audience_key: "all_members" }));
    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("rejects an unknown phone_number_id (400)", async () => {
    getAccountByPhoneNumberId.mockReturnValue(undefined);
    const res = await POST(postReq({ message_kind: "text", text: "Hi", phone_number_id: "BOGUS", audience_key: "all_members" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unknown WhatsApp account." });
    expect(createBroadcast).not.toHaveBeenCalled();
  });

  it("creates a free-text broadcast from the chosen account", async () => {
    const res = await POST(postReq({ message_kind: "text", text: "Salaam", phone_number_id: "PN2", audience_key: "all_members" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "started", broadcastId: "b1" });
    expect(createBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ messageKind: "text", text: "Salaam", account: ACCOUNT }),
    );
  });
});
