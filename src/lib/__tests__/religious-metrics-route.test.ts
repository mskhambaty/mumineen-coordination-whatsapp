import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePortalCaller: vi.fn(), getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => mocks.requirePortalCaller(...a) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => mocks.getSupabaseAdmin() }));

import { GET } from "@/app/api/admin/religious/metrics/route";

type AuditRow = { tool_name: string; arguments: unknown; result_summary: string; phone_e164: string; created_at: string };

// Supabase stub: the audit query (.in().not?...gte().order().limit()) resolves to `audit`; the two
// head-count queries (.eq()) resolve to { count }.
function supabaseWith(audit: AuditRow[]) {
  const auditChain: Record<string, unknown> = {};
  ["select", "in", "gte", "lte", "order"].forEach((m) => (auditChain[m] = () => auditChain));
  auditChain.limit = () => Promise.resolve({ data: audit, error: null });
  // Head-count chains: word-requests is .select().eq(); ruling-flags is .select().eq().gte().
  const countChain = { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ count: 0 }), then: (r: (v: unknown) => void) => r({ count: 0 }) }) }) };
  return {
    from: (table: string) => (table === "tool_audit_logs" ? auditChain : countChain),
  };
}
const req = (url = "http://localhost/api/admin/religious/metrics") => ({ nextUrl: new URL(url) }) as unknown as Parameters<typeof GET>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue({ caller: { portal: { role: "admin" } } });
});

describe("GET /api/admin/religious/metrics — recent_gaps", () => {
  it("collects recent unanswered Waaz questions (not_found / offer_last), deduped, newest-first", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseWith([
      { tool_name: "answer_religious_questions", arguments: { query: "What did Maula say about sabr?" }, result_summary: '{"decision":"not_found"}', phone_e164: "+1", created_at: "2026-06-14T10:00:00Z" },
      { tool_name: "answer_religious_questions", arguments: { query: "theme of majlis 4 this year" }, result_summary: '{"decision":"offer_last","year":"1447"}', phone_e164: "+2", created_at: "2026-06-14T09:00:00Z" },
      { tool_name: "answer_religious_questions", arguments: { query: "What did Maula say about sabr?" }, result_summary: '{"decision":"not_found"}', phone_e164: "+3", created_at: "2026-06-14T08:00:00Z" }, // dup
      { tool_name: "answer_religious_questions", arguments: { query: "who is the 53rd dai" }, result_summary: '{"decision":"answer"}', phone_e164: "+4", created_at: "2026-06-14T07:00:00Z" }, // answered → excluded
      { tool_name: "get_lisan_word_meaning", arguments: { word: "aflaak" }, result_summary: '{"status":"not_found"}', phone_e164: "+5", created_at: "2026-06-14T06:00:00Z" },
    ]));

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recent_gaps.map((g: { query: string }) => g.query)).toEqual([
      "What did Maula say about sabr?",
      "theme of majlis 4 this year",
    ]);
    // sanity on the rest of the summary
    expect(body.summary.waaz_questions).toBe(4);
    expect(body.summary.lisan_lookups).toBe(1);
    expect(body.summary.lisan_by_status.not_found).toBe(1);
  });

  it("denies an unauthorized caller", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
