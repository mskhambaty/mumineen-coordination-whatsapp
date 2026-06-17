import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => requirePortalCaller(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

// No broadcast account configured in tests → unscoped "main" inbox.
vi.mock("@/lib/whatsapp/accounts", () => ({
  getBroadcastAccount: () => null,
}));

import { GET } from "@/app/api/admin/conversations/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/admin/conversations${query}`);
}

const RESOLVED_SESSION = {
  id: "sess-resolved",
  phone_e164: "+15550000001",
  user_id: null,
  current_intent: null,
  state: null,
  last_message_at: "2026-01-01T00:00:00.000Z", // old → outside the recent window
  created_at: "2026-01-01T00:00:00.000Z",
  handling_mode: "ai",
  escalation_status: "resolved",
  escalation_stage: "resolved",
  escalation_priority: "normal",
  escalation_category: "transport",
  escalated_at: "2026-01-01T00:00:00.000Z",
  user: null,
  assigned_user: null,
  issue: null,
};

/**
 * Filter-aware mock: `conversation_sessions` is queried three ways (recent / pending / resolved).
 * We discriminate by the escalation_status equality filter so each query returns its own set.
 */
function mockSupabase() {
  return {
    from(table: string) {
      if (table === "conversation_sessions") {
        let statusFilter: string | null = null;
        const chain: Record<string, unknown> = {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          range: () => chain,
          or: () => chain,
          in: () => chain,
          eq: (col: string, val: string) => {
            if (col === "escalation_status") statusFilter = val;
            return chain;
          },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const data =
              statusFilter === "resolved" ? [RESOLVED_SESSION] : []; // recent + pending are empty
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return chain;
      }
      // messages / tool_audit_logs / issue_escalation_links → empty.
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        range: () => chain,
        or: () => chain,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res, rej),
      };
      return chain;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
  getSupabaseAdmin.mockReturnValue(mockSupabase());
});

describe("GET /api/admin/conversations — resolved escalation loading", () => {
  it("omits resolved escalations by default", async () => {
    const res = await GET(req());
    const json = await res.json();
    expect(json.conversations).toHaveLength(0);
    expect(json.resolved_has_more).toBe(false);
  });

  it("includes resolved escalations when ?includeResolved=1", async () => {
    const res = await GET(req("?includeResolved=1"));
    const json = await res.json();
    expect(json.conversations).toHaveLength(1);
    expect(json.conversations[0].phone_e164).toBe(RESOLVED_SESSION.phone_e164);
    expect(json.conversations[0].escalation_status).toBe("resolved");
  });
});
