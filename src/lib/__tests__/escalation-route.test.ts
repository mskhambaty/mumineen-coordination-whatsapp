import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyEscalationTeam = vi.fn();

// Mutable inbound-message count the mocked Supabase returns for the gate check.
let inboundCount = 0;

vi.mock("@/lib/escalation/notify", () => ({
  notifyEscalationTeam: (...args: unknown[]) => notifyEscalationTeam(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const result =
        table === "messages"
          ? { count: inboundCount }
          : table === "conversation_sessions"
            ? { data: { id: "c1", phone_e164: PHONE, escalation_status: "pending" }, error: null }
            : table === "whatsapp_users"
              ? { data: { display_name: "Guest" } }
              : { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        ilike: () => chain,
        maybeSingle: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
  }),
}));

import { POST } from "@/app/api/escalations/route";

const PHONE = "+15551234567";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/escalations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-whatsapp-from": PHONE },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inboundCount = 0;
});

describe("POST /api/escalations gate", () => {
  it("rejects with no x-whatsapp-from header", async () => {
    const res = new NextRequest("http://localhost/api/escalations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "x", category: "religious_followup", priority: "normal" }),
    });
    const out = await POST(res);
    expect(out.status).toBe(400);
  });

  it("religious_followup escalates on the very first inbound message (gate bypassed)", async () => {
    inboundCount = 0; // first message, would normally be below MIN_INBOUND_FOR_ESCALATION
    const out = await POST(
      req({ reason: "Should we fast on 10th Muharram", category: "religious_followup", priority: "normal" }),
    );
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.category).toBe("religious_followup");
    expect(notifyEscalationTeam).toHaveBeenCalledTimes(1);
  });

  it("a non-exempt category is still gated until enough inbound messages", async () => {
    inboundCount = 0;
    const out = await POST(req({ reason: "where do I register", category: "registration", priority: "normal" }));
    const json = await out.json();
    expect(json.status).toBe("declined");
    expect(notifyEscalationTeam).not.toHaveBeenCalled();
  });

  it("a non-exempt category escalates once the inbound threshold is met", async () => {
    inboundCount = 5;
    const out = await POST(req({ reason: "still stuck on registration", category: "registration", priority: "normal" }));
    const json = await out.json();
    expect(json.status).toBe("escalated");
  });
});
