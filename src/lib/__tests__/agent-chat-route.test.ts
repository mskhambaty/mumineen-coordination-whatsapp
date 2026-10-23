import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCallerFromSession = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, resolveCallerFromSession: (...a: unknown[]) => resolveCallerFromSession(...a) };
});

const handleInboundText = vi.fn(async () => undefined);
vi.mock("@/lib/agent/text-turn", () => ({ handleInboundText: (...a: unknown[]) => handleInboundText(...(a as [])) }));

const recordInAppInbound = vi.fn(async () => ({ id: "row-1", messageId: "inapp:1" }));
const deliverInApp = vi.fn(async () => "inapp:2");
vi.mock("@/lib/conversations/in-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conversations/in-app")>()),
  recordInAppInbound: (...a: unknown[]) => recordInAppInbound(...(a as [])),
  deliverInApp: (...a: unknown[]) => deliverInApp(...(a as [])),
}));

// Chainable Supabase fake: records every .eq() filter so tests can assert the thread is scoped to
// the caller's own phone; resolves per table.
const eqCalls: Array<[string, string, unknown]> = [];
let userRow: { phone_e164: string | null } | null = { phone_e164: "+13125550100" };
let messageRows: unknown[] = [];
function chain(table: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.select = self;
  q.is = self;
  q.order = self;
  q.limit = self;
  q.gte = self;
  q.eq = (col: string, val: unknown) => {
    eqCalls.push([table, col, val]);
    return q;
  };
  q.maybeSingle = async () => ({ data: table === "whatsapp_users" ? userRow : { handling_mode: "ai" }, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: messageRows, error: null });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => chain(t) }),
  getOrCreateWhatsappUser: vi.fn(async () => ({ id: "u1", phone_e164: "+13125550100", role: "committee" })),
  touchConversationSession: vi.fn(async () => undefined),
}));

import { GET, POST } from "@/app/api/agent-chat/route";

const portalCaller = {
  user_id: "u1",
  display_name: "Member",
  role: "committee",
  global_role: "member",
  can_read_all: false,
  can_write_all: false,
  departments: [],
  portal: { role: "committee", global_role: "member" },
};

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/agent-chat${qs}`));
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/agent-chat", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  userRow = { phone_e164: "+13125550100" };
  messageRows = [];
  resolveCallerFromSession.mockResolvedValue(portalCaller);
});

describe("/api/agent-chat auth", () => {
  it("returns 401 without a portal session", async () => {
    const { UnauthorizedError } = await import("@/lib/api/auth");
    resolveCallerFromSession.mockRejectedValue(new UnauthorizedError("no session"));
    expect((await get()).status).toBe(401);
    expect((await post({ text: "hi" })).status).toBe(401);
    expect(handleInboundText).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user without portal access", async () => {
    resolveCallerFromSession.mockResolvedValue({ ...portalCaller, role: "visitor", portal: { role: "visitor", global_role: "member" } });
    expect((await get()).status).toBe(403);
    expect((await post({ text: "hi" })).status).toBe(403);
  });

  it("returns 400 when the account has no phone number", async () => {
    userRow = { phone_e164: null };
    expect((await get()).status).toBe(400);
  });
});

describe("GET /api/agent-chat", () => {
  it("reads only the caller's own thread, hides notifications, labels senders", async () => {
    messageRows = [
      { id: "m4", direction: "outbound", body: "On it.", created_at: "2026-10-23T10:04:00Z", raw_payload: { source: "manual_admin", channel: "in_app" } },
      { id: "m3", direction: "outbound", body: "[template:escalation_ticket_assigned] x", created_at: "2026-10-23T10:03:00Z", raw_payload: {} },
      { id: "m2", direction: "outbound", body: "Salaam un Jameel", created_at: "2026-10-23T10:02:00Z", raw_payload: { channel: "in_app" } },
      { id: "m1", direction: "inbound", body: "Hi", created_at: "2026-10-23T10:01:00Z", raw_payload: { channel: "in_app" } },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(eqCalls).toContainEqual(["messages", "phone_e164", "+13125550100"]);
    expect(json.messages.map((m: { id: string; from: string }) => [m.id, m.from])).toEqual([
      ["m1", "you"],
      ["m2", "agent"],
      ["m4", "team"],
    ]);
  });

  it("rejects a malformed after cursor", async () => {
    expect((await get("?after=yesterday")).status).toBe(400);
  });
});

describe("POST /api/agent-chat", () => {
  it("records the message under the session's phone and runs the shared pipeline", async () => {
    const res = await post({ text: "  Where is parking?  ", visitor_mode: true });
    expect(res.status).toBe(201);
    expect(recordInAppInbound).toHaveBeenCalledWith({ phoneE164: "+13125550100", body: "Where is parking?", visitorMode: true });
    expect(handleInboundText).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: "+13125550100", body: "Where is parking?", messageId: "inapp:1", visitorMode: true }),
    );
  });

  it("ignores any phone the client sends — the thread is always the caller's own", async () => {
    await post({ text: "hi", phone: "+19998887777" });
    expect(recordInAppInbound).toHaveBeenCalledWith(expect.objectContaining({ phoneE164: "+13125550100" }));
  });

  it("delivers replies in-app (record only, no WhatsApp)", async () => {
    await post({ text: "hi" });
    const { deliver } = (handleInboundText.mock.calls[0] as unknown as [{ deliver: (t: string, e?: object) => Promise<void> }])[0];
    await deliver("Agent reply", { source: "registration_gate" });
    expect(deliverInApp).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: "+13125550100", body: "Agent reply", rawPayload: { source: "registration_gate" } }),
    );
  });

  it("returns 400 for an empty message", async () => {
    expect((await post({ text: "   " })).status).toBe(400);
    expect(handleInboundText).not.toHaveBeenCalled();
  });
});
