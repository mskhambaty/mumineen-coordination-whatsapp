import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const logEscalationActivity = vi.fn();

// Captures the payload written to conversation_sessions so we can assert the route no longer sets
// escalation_status (it's now derived from escalation_stage by a DB trigger).
let capturedUpdate: Record<string, unknown> | null = null;

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => requirePortalCaller(...args),
}));
vi.mock("@/lib/escalation/activity", () => ({
  logEscalationActivity: (...args: unknown[]) => logEscalationActivity(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === "conversation_sessions") {
        const chain: Record<string, unknown> = {
          update: (p: Record<string, unknown>) => { capturedUpdate = p; return chain; },
          eq: () => chain,
          in: () => chain,
          select: () => chain,
          maybeSingle: () => Promise.resolve({ data: { id: "s1", phone_e164: PHONE, escalation_stage: "resolved" }, error: null }),
        };
        return chain;
      }
      // issue_escalation_links (resolveOpenLinksForSession) → no open links.
      const chain: Record<string, unknown> = {
        update: () => chain,
        eq: () => chain,
        select: () => Promise.resolve({ data: [], error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    },
  }),
}));

import { POST } from "@/app/api/admin/escalations/[phoneE164]/resolve/route";

const PHONE = "+15551234567";
const ctx = { params: Promise.resolve({ phoneE164: PHONE }) };

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/admin/escalations/${PHONE}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdate = null;
  requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
  logEscalationActivity.mockResolvedValue(undefined);
});

describe("POST /api/admin/escalations/[phone]/resolve", () => {
  it("sets escalation_stage and does NOT write escalation_status (trigger derives it)", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate).toMatchObject({ escalation_stage: "resolved" });
    expect(capturedUpdate).not.toHaveProperty("escalation_status");
  });

  it("returns 403 when the caller fails the inbox gate", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
  });
});
