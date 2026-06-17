import { NextRequest, NextResponse } from "next/server";
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

import { GET } from "@/app/api/admin/issues/[issueId]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(): NextRequest {
  return new NextRequest("http://localhost/api/admin/issues/iss1");
}

const ctx = { params: Promise.resolve({ issueId: "iss1" }) };

/** Fluent chain builder; each table resolves to its canned `{ data }`. */
function mockSupabase(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const data = tables[table] ?? null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(res, rej),
      };
      return chain;
    },
  };
}

const PAST = "2000-01-01T00:00:00.000Z"; // SLA deadline well in the past

function tablesWith(sessionOverrides: Record<string, unknown>, linkStatus: "open" | "resolved" = "open") {
  return {
    issues: {
      id: "iss1",
      issue_number: 17,
      title: "Carpool offer",
      description: null,
      status: "open",
      priority: "medium",
      department_id: null,
      department: null,
      assignee: null,
      creator: null,
      created_by: null,
      created_at: PAST,
      updated_at: PAST,
      assigned_to: null,
    },
    issue_escalation_links: [
      {
        id: "link1",
        linked_at: PAST,
        status: linkStatus,
        resolved_at: linkStatus === "resolved" ? PAST : null,
        session: {
          id: "sess1",
          phone_e164: "+15551234567",
          escalation_priority: "normal",
          escalation_category: "transport",
          escalation_reason: "needs a ride",
          escalated_at: PAST,
          escalation_sla_deadline: PAST,
          escalation_assigned_to: null,
          user: { display_name: "Guest" },
          ...sessionOverrides,
        },
      },
    ],
    escalation_activity_log: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
});

describe("GET /api/admin/issues/[issueId] — linked-escalation resolved-ness", () => {
  it("returns 403 when the caller fails the inbox gate", async () => {
    requirePortalCaller.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("does NOT flag a resolved LINK as breaching, even with a past deadline", async () => {
    // Resolved-ness is per-link (this conversation's episode in this issue), independent of the
    // conversation's current escalation_status (which may have moved on to another topic).
    getSupabaseAdmin.mockReturnValue(
      mockSupabase(tablesWith({ escalation_status: "pending", escalation_stage: "picked_up" }, "resolved")),
    );
    const res = await GET(req(), ctx);
    const json = await res.json();
    expect(json.escalations).toHaveLength(1);
    expect(json.escalations[0].link_status).toBe("resolved");
    expect(json.escalations[0].breaching).toBe(false);
  });

  it("flags an open link past its SLA deadline as breaching", async () => {
    getSupabaseAdmin.mockReturnValue(
      mockSupabase(tablesWith({ escalation_status: "pending", escalation_stage: "picked_up" }, "open")),
    );
    const res = await GET(req(), ctx);
    const json = await res.json();
    expect(json.escalations[0].link_status).toBe("open");
    expect(json.escalations[0].breaching).toBe(true);
  });
});
