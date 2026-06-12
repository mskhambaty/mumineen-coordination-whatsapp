import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const requireAdminKey = vi.fn();
const resolveCallerFromSession = vi.fn();
const getSupabaseAdmin = vi.fn();
const aiCreate = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireAdminKey: (...args: unknown[]) => requireAdminKey(...args),
    resolveCallerFromSession: (...args: unknown[]) => resolveCallerFromSession(...args),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

vi.mock("@/lib/ai/model", () => ({
  AI_MODEL: "test-model",
  PARSE_TEMPERATURE: 0.1,
  MAX_AGENT_TOKENS: 1024,
  getAIClient: () => ({ chat: { completions: { create: aiCreate } } }),
  chatParams: (model: string, opts: Record<string, unknown>) => ({
    model,
    max_completion_tokens: opts.maxTokens,
    temperature: opts.temperature,
  }),
}));

import { GET } from "@/app/api/admin/issues/suggestions/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(): NextRequest {
  return new NextRequest("http://localhost/api/admin/issues/suggestions");
}

/** Fluent chain builder that resolves tables → canned data. */
function mockSupabase(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const data = tables[table] ?? null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(res, rej),
      };
      return chain;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/issues/suggestions", () => {
  beforeEach(() => {
    requireAdminKey.mockReset();
    resolveCallerFromSession.mockReset();
    getSupabaseAdmin.mockReset();
    aiCreate.mockReset();
  });

  it("returns 401 when caller lacks inbox access", async () => {
    requireAdminKey.mockReturnValue(false);
    const { UnauthorizedError } = await import("@/lib/api/auth");
    resolveCallerFromSession.mockRejectedValue(new UnauthorizedError("no session"));

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns empty suggestions when no ungrouped escalations exist", async () => {
    requireAdminKey.mockReturnValue(true);
    getSupabaseAdmin.mockReturnValue(
      mockSupabase({
        conversation_sessions: [],
        issues: [],
        departments: [],
        issue_escalation_links: [],
      }),
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.new_clusters).toEqual([]);
    expect(body.existing_issue_matches).toEqual([]);
    expect(body.meta.ungrouped_count).toBe(0);
    expect(aiCreate).not.toHaveBeenCalled();
  });

  it("calls AI model and returns structured suggestions when escalations exist", async () => {
    requireAdminKey.mockReturnValue(true);

    const sessions = [
      {
        id: "s1",
        phone_e164: "+15551111111",
        escalation_reason: "AC not working in room",
        escalated_at: "2026-06-10T10:00:00Z",
        escalation_stage: "pending",
        escalation_status: "pending",
        linked_issue_id: null,
        user: { display_name: "Guest A" },
      },
      {
        id: "s2",
        phone_e164: "+15552222222",
        escalation_reason: "No cold air from AC unit",
        escalated_at: "2026-06-10T11:00:00Z",
        escalation_stage: "picked_up",
        escalation_status: "pending",
        linked_issue_id: null,
        user: { display_name: "Guest B" },
      },
    ];

    const openIssues = [
      {
        id: "iss1",
        issue_number: 5,
        title: "Water leak in lobby",
        description: "Water dripping from ceiling",
        status: "open",
        priority: "high",
        department: { name: "Facilities" },
      },
    ];

    const departments = [
      { id: "d1", name: "Facilities" },
      { id: "d2", name: "Transport" },
    ];

    const messages = [
      { phone_e164: "+15551111111", body: "My AC has been broken since yesterday", created_at: "2026-06-10T09:00:00Z" },
      { phone_e164: "+15552222222", body: "The room is so hot!", created_at: "2026-06-10T10:30:00Z" },
    ];

    // Table-aware mock: return different data per table
    getSupabaseAdmin.mockReturnValue({
      from(table: string) {
        let data: unknown;
        if (table === "conversation_sessions") data = sessions;
        else if (table === "issues") data = openIssues;
        else if (table === "departments") data = departments;
        else if (table === "issue_escalation_links") data = [{ issue_id: "iss1" }];
        else if (table === "messages") data = messages;
        else data = [];

        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          in: () => chain,
          is: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ data, error: null }).then(res, rej),
        };
        return chain;
      },
    });

    // AI returns one new cluster and one existing issue match
    aiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_clusters: [
                {
                  suggested_title: "AC failures across multiple rooms",
                  suggested_description: "Multiple guests reporting non-functional air conditioning",
                  suggested_priority: "high",
                  suggested_department_id: "d1",
                  suggested_department_name: "Facilities",
                  category: "accommodation",
                  reasoning: "Two separate reports of AC problems suggest a systemic issue",
                  escalation_ids: ["s1", "s2"],
                },
              ],
              existing_issue_matches: [],
            }),
          },
        },
      ],
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    // AI was called
    expect(aiCreate).toHaveBeenCalledTimes(1);

    // new_clusters populated with escalation details hydrated
    expect(body.new_clusters).toHaveLength(1);
    expect(body.new_clusters[0].suggested_title).toBe("AC failures across multiple rooms");
    expect(body.new_clusters[0].escalations).toHaveLength(2);
    expect(body.new_clusters[0].escalations[0].session_id).toBe("s1");
    expect(body.new_clusters[0].escalations[0].display_name).toBe("Guest A");

    // meta
    expect(body.meta.ungrouped_count).toBe(2);
    expect(body.meta.analyzed_at).toBeDefined();
  });
});
