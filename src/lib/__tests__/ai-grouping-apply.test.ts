import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Stubs — must be declared before vi.mock hoisting
// ---------------------------------------------------------------------------

const requirePortalCaller = vi.fn();
const logEscalationActivity = vi.fn();
const notifyDepartmentIssueContacts = vi.fn();

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

vi.mock("@/lib/issues/notify", () => ({
  notifyDepartmentIssueContacts: (...args: unknown[]) => notifyDepartmentIssueContacts(...args),
}));

import { POST } from "@/app/api/admin/issues/suggestions/apply/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/issues/suggestions/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/issues/suggestions/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseImpl = null;
    notifyDepartmentIssueContacts.mockResolvedValue(0);
    logEscalationActivity.mockResolvedValue(undefined);
  });

  it("returns 401 when caller lacks inbox access", async () => {
    requirePortalCaller.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(req({ title: "Test", session_ids: ["s1", "s2"] }));
    expect(res.status).toBe(401);
    expect(supabaseImpl).toBeNull(); // getSupabaseAdmin never called
  });

  it("returns 400 for invalid body (empty title)", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
    // minimal supabase so it doesn't blow up if validation somehow passes
    supabaseImpl = { from: () => buildChain({ data: null, error: null }) };

    const res = await POST(req({ title: "", session_ids: ["s1", "s2"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
  });

  it("returns 400 for invalid body (empty session_ids array)", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
    supabaseImpl = { from: () => buildChain({ data: null, error: null }) };

    const res = await POST(req({ title: "Valid title", session_ids: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
  });

  it("returns 400 for invalid body (missing session_ids)", async () => {
    requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", display_name: "Admin" } });
    supabaseImpl = { from: () => buildChain({ data: null, error: null }) };

    const res = await POST(req({ title: "Valid title" }));
    expect(res.status).toBe(400);
  });

  it("creates issue and links sessions successfully", async () => {
    requirePortalCaller.mockResolvedValue({
      caller: { user_id: "u1", display_name: "Admin" },
    });

    const createdIssue = {
      id: "issue-abc",
      issue_number: 7,
      title: "AC failures across multiple rooms",
      status: "open",
    };

    const SESSION_1 = "550e8400-e29b-41d4-a716-000000000001";
    const SESSION_2 = "550e8400-e29b-41d4-a716-000000000002";

    const sessionMap: Record<string, { id: string; phone_e164: string }> = {
      [SESSION_1]: { id: SESSION_1, phone_e164: "+15551111111" },
      [SESSION_2]: { id: SESSION_2, phone_e164: "+15552222222" },
    };

    supabaseImpl = {
      from(table: string) {
        if (table === "issues") {
          // insert → select → single chain
          const insertChain: Record<string, unknown> = {
            insert: () => insertChain,
            select: () => insertChain,
            single: () => Promise.resolve({ data: createdIssue, error: null }),
          };
          return insertChain;
        }

        if (table === "conversation_sessions") {
          // The handler does:
          //   .from("conversation_sessions").select(...).eq("id", sessionId).maybeSingle()
          //   .from("conversation_sessions").update(...).eq("id", session.id)
          let resolveData: unknown = null;
          const chain: Record<string, unknown> = {};
          chain["select"] = () => chain;
          chain["update"] = () => chain;
          chain["eq"] = (_col: string, val: string) => {
            resolveData = sessionMap[val] ?? null;
            return chain;
          };
          chain["maybeSingle"] = () =>
            Promise.resolve({ data: resolveData, error: null });
          chain["then"] = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(res);
          return chain;
        }

        if (table === "issue_escalation_links") {
          const chain: Record<string, unknown> = {
            insert: () => chain,
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(res),
          };
          return chain;
        }

        return buildChain({ data: null, error: null });
      },
    };

    const res = await POST(
      req({
        title: "AC failures across multiple rooms",
        description: "Multiple guests reporting non-functional AC",
        priority: "high",
        session_ids: [SESSION_1, SESSION_2],
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.issue.id).toBe("issue-abc");
    expect(body.issue.issue_number).toBe(7);
    expect(body.issue.title).toBe("AC failures across multiple rooms");
    expect(body.issue.status).toBe("open");
    expect(body.linked_count).toBe(2);

    // created_issue activity logged once
    expect(logEscalationActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "created_issue", issueId: "issue-abc" }),
    );
    // linked_to_issue activity logged once per session
    expect(logEscalationActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "linked_to_issue", issueId: "issue-abc" }),
    );
    expect(logEscalationActivity).toHaveBeenCalledTimes(3); // 1 created + 2 linked
  });

  it("fires department notification when department_id is provided", async () => {
    requirePortalCaller.mockResolvedValue({
      caller: { user_id: "u1", display_name: "Admin" },
    });

    const createdIssue = {
      id: "issue-xyz",
      issue_number: 8,
      title: "Test with dept",
      status: "open",
    };

    const SESSION_1 = "550e8400-e29b-41d4-a716-000000000001";
    const session = { id: SESSION_1, phone_e164: "+15551111111" };

    supabaseImpl = {
      from(table: string) {
        if (table === "issues") {
          const c: Record<string, unknown> = {
            insert: () => c,
            select: () => c,
            single: () => Promise.resolve({ data: createdIssue, error: null }),
          };
          return c;
        }
        if (table === "conversation_sessions") {
          const c: Record<string, unknown> = {
            select: () => c,
            update: () => c,
            eq: () => c,
            maybeSingle: () => Promise.resolve({ data: session, error: null }),
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(res),
          };
          return c;
        }
        if (table === "issue_escalation_links") {
          const c: Record<string, unknown> = {
            insert: () => c,
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(res),
          };
          return c;
        }
        return buildChain({ data: null, error: null });
      },
    };

    const res = await POST(
      req({
        title: "Test with dept",
        session_ids: [SESSION_1],
        department_id: "550e8400-e29b-41d4-a716-000000000099",
      }),
    );

    expect(res.status).toBe(201);
    expect(notifyDepartmentIssueContacts).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-xyz", departmentId: "550e8400-e29b-41d4-a716-000000000099" }),
    );
  });

  it("skips a session that cannot be found and still returns linked_count for found ones", async () => {
    requirePortalCaller.mockResolvedValue({
      caller: { user_id: "u1", display_name: "Admin" },
    });

    const createdIssue = {
      id: "issue-def",
      issue_number: 9,
      title: "Partial link test",
      status: "open",
    };

    supabaseImpl = {
      from(table: string) {
        if (table === "issues") {
          const c: Record<string, unknown> = {
            insert: () => c,
            select: () => c,
            single: () => Promise.resolve({ data: createdIssue, error: null }),
          };
          return c;
        }
        if (table === "conversation_sessions") {
          // Return null for all lookups (session not found)
          const c: Record<string, unknown> = {
            select: () => c,
            update: () => c,
            eq: () => c,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(res),
          };
          return c;
        }
        if (table === "issue_escalation_links") {
          const c: Record<string, unknown> = {
            insert: () => c,
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(res),
          };
          return c;
        }
        return buildChain({ data: null, error: null });
      },
    };

    const res = await POST(
      req({
        title: "Partial link test",
        session_ids: [
          "550e8400-e29b-41d4-a716-000000000011",
          "550e8400-e29b-41d4-a716-000000000022",
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.linked_count).toBe(0);
  });
});
