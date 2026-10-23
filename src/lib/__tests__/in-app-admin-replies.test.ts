import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin-to-member replies into an IN-APP agent chat conversation must be recorded (so they show in
// the member's chat page) and must never attempt WhatsApp — the number is gone.

const mocks = vi.hoisted(() => ({
  requirePortalCaller: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppImage: vi.fn(),
  uploadWhatsAppMedia: vi.fn(),
  recordOutboundMessage: vi.fn(),
  touchConversationSession: vi.fn(),
  lastInbound: null as { raw_payload?: unknown; created_at?: string } | null,
  sessionUpdate: vi.fn(),
}));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => mocks.requirePortalCaller(...a) }));
vi.mock("@/lib/meta/whatsapp", () => ({
  sendWhatsAppText: (...a: unknown[]) => mocks.sendWhatsAppText(...a),
  sendWhatsAppImage: (...a: unknown[]) => mocks.sendWhatsAppImage(...a),
  uploadWhatsAppMedia: (...a: unknown[]) => mocks.uploadWhatsAppMedia(...a),
}));

function chain(table: string) {
  const q: Record<string, unknown> = {};
  ["select", "eq", "order", "limit"].forEach((m) => (q[m] = () => q));
  q.maybeSingle = async () =>
    table === "messages"
      ? { data: mocks.lastInbound }
      : { data: { id: "s1", user_id: "u1", handling_mode: "manual" }, error: null };
  q.update = (...a: unknown[]) => {
    mocks.sessionUpdate(...a);
    return { eq: async () => ({ error: null }) };
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => chain(t) }),
  recordOutboundMessage: (...a: unknown[]) => mocks.recordOutboundMessage(...a),
  touchConversationSession: (...a: unknown[]) => mocks.touchConversationSession(...a),
}));

import { isInAppConversation } from "@/lib/conversations/in-app";
import { POST as inboxReply } from "@/app/api/admin/conversations/[phoneE164]/messages/route";
import { POST as religiousReply } from "@/app/api/admin/religious/reply/route";

const PHONE = "+13125550100";
const ctx = { params: Promise.resolve({ phoneE164: encodeURIComponent(PHONE) }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue({ caller: { portal: { role: "admin" } } });
  mocks.sendWhatsAppText.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
  mocks.recordOutboundMessage.mockResolvedValue(undefined);
  mocks.lastInbound = { raw_payload: { channel: "in_app" }, created_at: "2020-01-01T00:00:00Z" };
});

describe("isInAppConversation", () => {
  it("is true when the latest inbound came from the in-app chat", async () => {
    expect(await isInAppConversation(PHONE)).toBe(true);
  });

  it("is false for a WhatsApp-origin conversation", async () => {
    mocks.lastInbound = { raw_payload: { from: PHONE, type: "text" } };
    expect(await isInAppConversation(PHONE)).toBe(false);
  });
});

describe("Inbox manual reply → in-app conversation", () => {
  it("records the reply in-app and does not call WhatsApp", async () => {
    const res = await inboxReply(
      new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ body: "A volunteer is on the way." }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.recordOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneE164: PHONE,
        body: "A volunteer is on the way.",
        whatsappMessageId: expect.stringMatching(/^inapp:/),
        rawPayload: expect.objectContaining({ source: "manual_admin", channel: "in_app" }),
      }),
    );
  });

  it("rejects an image reply for an in-app conversation", async () => {
    const form = new FormData();
    form.set("image", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const res = await inboxReply(new NextRequest("http://localhost/x", { method: "POST", body: form }), ctx);
    expect(res.status).toBe(400);
    expect(mocks.uploadWhatsAppMedia).not.toHaveBeenCalled();
    expect(mocks.recordOutboundMessage).not.toHaveBeenCalled();
  });
});

describe("Religious dashboard reply → in-app conversation", () => {
  it("records in-app outside the 24h window, skips WhatsApp, and leaves session state alone", async () => {
    const res = (await religiousReply(
      { json: async () => ({ phone: PHONE, text: "Shukran for asking." }) } as unknown as NextRequest,
    )) as NextResponse;
    expect(res.status).toBe(200);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.touchConversationSession).not.toHaveBeenCalled();
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({ last_message_at: expect.any(String) });
    expect(mocks.recordOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ rawPayload: expect.objectContaining({ source: "religious_dashboard_reply", channel: "in_app" }) }),
    );
  });
});
