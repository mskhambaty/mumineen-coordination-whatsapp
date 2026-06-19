import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture rows inserted into each table so we can assert how a free-text broadcast is persisted.
const inserted: Record<string, unknown> = {};
const previewAudience = vi.fn();

vi.mock("@/lib/whatsapp/audience", () => ({
  previewAudience: (...a: unknown[]) => previewAudience(...a),
  getInWindowPhones: vi.fn(async () => new Set<string>()),
  normalizePhone: (p: string) => p,
  utilityMessageCostUsd: () => 0.0125,
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserted[table] = payload;
        return {
          select: () => ({ single: async () => ({ data: { id: "b1" }, error: null }) }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
      },
    }),
  }),
  recordOutboundMessage: vi.fn(),
}));
// Template-path-only deps — stub so the module imports cleanly and isn't exercised here.
vi.mock("@/lib/whatsapp/send-template", () => ({ resolveApprovedTemplate: vi.fn(), sendTemplateNotification: vi.fn() }));
vi.mock("@/lib/meta/whatsapp", () => ({ sendWhatsAppText: vi.fn() }));
vi.mock("@/lib/whatsapp/undeliverable", () => ({ suppressedPhones: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/whatsapp/templates", () => ({ resolveBindings: vi.fn() }));

import { createBroadcast } from "@/lib/whatsapp/broadcast";

const ACCOUNT = { label: "broadcast", phoneNumberId: "PN2", accessToken: "t", wabaId: "WABA2" };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(inserted)) delete inserted[k];
  previewAudience.mockResolvedValue({
    recipients: [
      { phone: "+1630111", familyId: null, inWindow: true, fields: {} },
      { phone: "+1630222", familyId: null, inWindow: true, fields: {} },
    ],
  });
});

describe("createBroadcast — free text", () => {
  it("requires an account", async () => {
    const res = await createBroadcast({ messageKind: "text", text: "Hi", audienceKey: "all_members" });
    expect(res).toMatchObject({ error: expect.stringContaining("account") });
  });

  it("requires a non-empty body", async () => {
    const res = await createBroadcast({ messageKind: "text", text: "   ", audienceKey: "all_members", account: ACCOUNT });
    expect(res).toMatchObject({ error: expect.stringContaining("empty") });
  });

  it("forces the in-window audience and persists a text broadcast", async () => {
    const res = await createBroadcast({
      messageKind: "text",
      text: "Salaam mumineen",
      audienceKey: "all_members",
      windowFilter: "all", // should be overridden to in_window
      account: ACCOUNT,
    });

    // Audience resolved with the in-window filter regardless of the requested one.
    expect(previewAudience).toHaveBeenCalledWith("all_members", [], undefined, "in_window", undefined);

    // Broadcast row records kind/text/account, no template, and zero cost (in-window = free).
    const row = inserted["template_broadcasts"] as Record<string, unknown>;
    expect(row.message_kind).toBe("text");
    expect(row.freeform_text).toBe("Salaam mumineen");
    expect(row.template_code).toBeNull();
    expect(row.phone_number_id).toBe("PN2");
    expect(row.est_cost_usd).toBe(0);

    // Recipients enqueued with no template params.
    const recips = inserted["template_broadcast_recipients"] as { body_params: unknown; send_status: string }[];
    expect(recips).toHaveLength(2);
    expect(recips[0].body_params).toBeNull();
    expect(recips[0].send_status).toBe("queued");

    expect(res).toMatchObject({ broadcastId: "b1", total: 2, free: 2, paid: 0, skipped: 0, estCostUsd: 0 });
  });
});
