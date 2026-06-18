import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyEscalationTeam = vi.fn();

// Mutable inbound-message count the mocked Supabase returns for the gate check.
let inboundCount = 0;
// Existing issue_escalation_links rows for THIS conversation (drives the re-escalation idempotency check).
let existingLinks: Array<{ issue_id: string; issues: { status: string } | null }> = [];
// Records insert() calls per table so tests can assert whether a new issue was created.
let inserts: Record<string, unknown[]> = {};

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
              : table === "issue_escalation_links"
                ? { data: existingLinks, error: null }
                : table === "issues"
                  ? { data: { id: "new-issue", title: "t" }, error: null }
                  : { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        insert: (rows: unknown) => { (inserts[table] ||= []).push(rows); return chain; },
        eq: () => chain,
        in: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve(result),
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
  existingLinks = [];
  inserts = {};
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

  it("lost_found escalates on the first inbound message because lost reports auto-escalate", async () => {
    const out = await POST(
      req({ reason: "Lost item reported: black backpack", category: "lost_found", priority: "normal" }),
    );
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.category).toBe("lost_found");
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

describe("POST /api/escalations issue creation (escalation ≠ issue)", () => {
  it("does NOT create an issue when the problem doesn't need department coordination", async () => {
    inboundCount = 5;
    // An individual request escalated to the on-call team — no requires_department_coordination flag.
    const out = await POST(req({ reason: "please call me about my parking pass", category: "transport", priority: "normal" }));
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.issue_id).toBeNull();
    expect(json.deduplicated).toBe(false);
    expect(inserts.issues).toBeUndefined();
    expect(inserts.tasks).toBeUndefined();
  });

  it("creates an issue + task when requires_department_coordination is true", async () => {
    inboundCount = 5;
    existingLinks = [];
    const out = await POST(req({ reason: "the AC is out in the men's hall", category: "facilities", priority: "normal", requires_department_coordination: true }));
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.deduplicated).toBe(false);
    expect(inserts.issues).toHaveLength(1);
    expect(inserts.tasks).toHaveLength(1);
  });

  it("reuses the conversation's existing OPEN issue instead of creating a duplicate (ISS-21/22)", async () => {
    inboundCount = 5;
    existingLinks = [{ issue_id: "iss-21", issues: { status: "open" } }];
    const out = await POST(req({ reason: "the AC is still out", category: "facilities", priority: "normal", requires_department_coordination: true }));
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.issue_id).toBe("iss-21");
    expect(json.deduplicated).toBe(true);
    // No new issue (and therefore no duplicate task) was created.
    expect(inserts.issues).toBeUndefined();
    expect(inserts.tasks).toBeUndefined();
  });

  it("creates a new issue when the conversation's only linked issue is already resolved", async () => {
    inboundCount = 5;
    existingLinks = [{ issue_id: "iss-old", issues: { status: "resolved" } }];
    const out = await POST(req({ reason: "new facility problem", category: "facilities", priority: "normal", requires_department_coordination: true }));
    const json = await out.json();
    expect(json.status).toBe("escalated");
    expect(json.deduplicated).toBe(false);
    expect(inserts.issues).toHaveLength(1);
  });
});
