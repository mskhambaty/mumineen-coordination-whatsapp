import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePortalCaller: vi.fn(),
  sendWhatsAppText: vi.fn(),
  recordOutboundMessage: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => mocks.requirePortalCaller(...a) }));
vi.mock("@/lib/meta/whatsapp", () => ({ sendWhatsAppText: (...a: unknown[]) => mocks.sendWhatsAppText(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => mocks.getSupabaseAdmin(),
  recordOutboundMessage: (...a: unknown[]) => mocks.recordOutboundMessage(...a),
}));

import { POST } from "@/app/api/admin/religious/reply/route";

// Supabase stub: messages.…maybeSingle() → last inbound; conversation_sessions.update().eq() → ok.
function supabaseWith(lastInbound: { created_at: string } | null) {
  const sessUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
  const msgChain: Record<string, unknown> = {};
  ["select", "eq", "order", "limit"].forEach((m) => (msgChain[m] = () => msgChain));
  msgChain.maybeSingle = () => Promise.resolve({ data: lastInbound });
  return {
    client: { from: (t: string) => (t === "messages" ? msgChain : { update: sessUpdate }) },
    sessUpdate,
  };
}

const req = (body: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue({ caller: { portal: { role: "admin" } } }); // authorized
  mocks.sendWhatsAppText.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
  mocks.recordOutboundMessage.mockResolvedValue(undefined);
});

describe("POST /api/admin/religious/reply", () => {
  it("sends + records when the member is inside the 24h window", async () => {
    const { client, sessUpdate } = supabaseWith({ created_at: minutesAgo(60) });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await POST(req({ phone: "+15551234567", text: "Wa alaikum salaam" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true, whatsapp_message_id: "wamid.1" });
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith("+15551234567", "Wa alaikum salaam");
    expect(mocks.recordOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: "+15551234567", rawPayload: expect.objectContaining({ source: "religious_dashboard_reply" }) }),
    );
    expect(sessUpdate).toHaveBeenCalledWith(expect.objectContaining({ last_message_at: expect.any(String) }));
    // State-preserving: never resets current_intent / state / handling_mode.
    expect(sessUpdate.mock.calls[0][0]).not.toHaveProperty("current_intent");
    expect(sessUpdate.mock.calls[0][0]).not.toHaveProperty("handling_mode");
  });

  it("refuses with 422 when the member is OUTSIDE the 24h window (no send)", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseWith({ created_at: minutesAgo(25 * 60) }).client);
    const res = await POST(req({ phone: "+15551234567", text: "hello" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ out_of_window: true });
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("refuses with 422 when there is no inbound message on record", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseWith(null).client);
    const res = await POST(req({ phone: "+15551234567", text: "hello" }));
    expect(res.status).toBe(422);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("denies an unauthorized caller (and never sends)", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const res = await POST(req({ phone: "+15551234567", text: "hello" }));
    expect(res.status).toBe(403);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("rejects an empty message with 400", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseWith({ created_at: minutesAgo(10) }).client);
    const res = await POST(req({ phone: "+15551234567", text: "   " }));
    expect(res.status).toBe(400);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });
});
