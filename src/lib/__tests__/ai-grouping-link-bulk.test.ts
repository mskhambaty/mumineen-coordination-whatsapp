import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Stubs — must be declared before vi.mock hoisting
// ---------------------------------------------------------------------------

const requirePortalCaller = vi.fn();
const logEscalationActivity = vi.fn();

// Supabase chain factory
type ChainResult = { data: unknown; error: unknown };
const buildChain = (result: ChainResult) => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    insert: () => chain,
    update: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  };
  return chain;
};

// Supabase mock factory — callers set this before each test
let supabaseImpl: { from: (table: string) => unknown } | null = null;

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => requirePortalCaller(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => supabaseImpl,
}));

vi.mock("@/lib/escalation/activity", () => ({
  logEscalationActivity: (...args: unknown[]) => logEscalationActivity(...args),
}));

import { POST } from "@/app/api/admin/issues/[issueId]/link-bulk/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/admin/issues/test-issue-id/link-bulk",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/issues/[issueId]/link-bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseImpl = null;
    logEscalationActivity.mockResolvedValue(undefined);
  });

  it("returns 401 when caller lacks inbox access", async () => {
    requirePortalCaller.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const routeCtx = { params: Promise.resolve({ issueId: "test-issue-id" }) };
    const res = await POST(makeReq({ session_ids: ["s1"] }), routeCtx);
    expect(res.status).toBe(401);
    expect(supabaseImpl).toBeNull(); // getSupabaseAdmin never called
  });

  it("returns 404 when issue does not exist", async () => {
    requirePortalCaller.mockResolvedValue({
      caller: { user_id: "u1", display_name: "Admin" },
    });

    supabaseImpl = {
      from(table: string) {
        if (table === "issues") {
          return buildChain({ data: null, error: null });
        }
        return buildChain({ data: null, error: null });
      },
    };

    const routeCtx = {
      params: Promise.resolve({ issueId: "nonexistent-issue" }),
    };
    const res = await POST(makeReq({ session_ids: ["s1"] }), routeCtx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Issue not found");
  });

  it("links sessions and returns correct linked_count and skipped_count", async () => {
    requirePortalCaller.mockResolvedValue({
      caller: { user_id: "u1", display_name: "Admin" },
    });

    const existingIssue = {
      id: "test-issue-id",
      issue_number: 5,
      title: "Elevator broken on floor 3",
    };

    const SESSION_1 = "550e8400-e29b-41d4-a716-000000000001";
    const SESSION_2 = "550e8400-e29b-41d4-a716-000000000002";
    const SESSION_DUP = "550e8400-e29b-41d4-a716-000000000003";

    const sessionMap: Record<string, { id: string; phone_e164: string }> = {
      [SESSION_1]: { id: SESSION_1, phone_e164: "+15551111111" },
      [SESSION_2]: { id: SESSION_2, phone_e164: "+15552222222" },
      // SESSION_DUP will trigger a 23505 duplicate error
    };

    let insertCallCount = 0;

    supabaseImpl = {
      from(table: string) {
        if (table === "issues") {
          return buildChain({ data: existingIssue, error: null });
        }

        if (table === "conversation_sessions") {
          let resolveData: unknown = null;
          const chain: Record<string, unknown> = {};
          chain["select"] = () => chain;
          chain["update"] = () => chain;
          chain["eq"] = (_col: string, val: string) => {
            // Only capture the value when querying by id
            if (val in sessionMap) {
              resolveData = sessionMap[val];
            } else if (val === SESSION_DUP) {
              resolveData = { id: SESSION_DUP, phone_e164: "+15553333333" };
            }
            return chain;
          };
          chain["maybeSingle"] = () =>
            Promise.resolve({ data: resolveData, error: null });
          chain["then"] = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(res);
          return chain;
        }

        if (table === "issue_escalation_links") {
          const chain: Record<string, unknown> = {};
          chain["insert"] = () => {
            insertCallCount++;
            // Third insert simulates a duplicate error (23505)
            const isDuplicate = insertCallCount >= 3;
            const insertChain: Record<string, unknown> = {
              then: (res: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: null,
                  error: isDuplicate ? { code: "23505", message: "duplicate" } : null,
                }).then(res),
            };
            return insertChain;
          };
          return chain;
        }

        return buildChain({ data: null, error: null });
      },
    };

    const routeCtx = {
      params: Promise.resolve({ issueId: "test-issue-id" }),
    };

    const res = await POST(
      makeReq({ session_ids: [SESSION_1, SESSION_2, SESSION_DUP] }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    // SESSION_1 and SESSION_2 linked, SESSION_DUP skipped (duplicate)
    expect(body.linked_count).toBe(2);
    expect(body.skipped_count).toBe(1);

    // Activity logged once per successfully linked session
    expect(logEscalationActivity).toHaveBeenCalledTimes(2);
    expect(logEscalationActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "linked_to_issue",
        issueId: "test-issue-id",
      }),
    );
  });
});
