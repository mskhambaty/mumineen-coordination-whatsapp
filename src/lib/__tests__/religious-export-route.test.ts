import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCaller: vi.fn(),
  toolRows: [] as unknown[],
  msgRows: [] as unknown[],
  userRows: [] as unknown[],
  gteCalls: [] as unknown[][],
  lteCalls: [] as unknown[][],
}));

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => mocks.requireCaller(...a),
}));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const result =
        table === "tool_audit_logs"
          ? { data: mocks.toolRows, error: null }
          : table === "messages"
            ? { data: mocks.msgRows, error: null }
            : table === "whatsapp_users"
              ? { data: mocks.userRows, error: null }
              : { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "not", "order", "limit", "eq"]) chain[m] = () => chain;
      chain.gte = (...a: unknown[]) => { mocks.gteCalls.push(a); return chain; };
      chain.lte = (...a: unknown[]) => { mocks.lteCalls.push(a); return chain; };
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej);
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/admin/conversations/religious-export/route";

function req(qs = "") {
  return new NextRequest(`http://localhost/api/admin/conversations/religious-export${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toolRows = [];
  mocks.msgRows = [];
  mocks.userRows = [];
  mocks.gteCalls = [];
  mocks.lteCalls = [];
  mocks.requireCaller.mockResolvedValue({ id: "admin1", role: "admin" }); // authorized by default
});

describe("GET /api/admin/conversations/religious-export", () => {
  it("rejects an unauthorized caller", async () => {
    mocks.requireCaller.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns a downloadable HTML transcript of the religious chats", async () => {
    mocks.toolRows = [
      { phone_e164: "+17087454219", tool_name: "answer_religious_questions", created_at: "2026-06-14T05:00:01Z" },
    ];
    mocks.msgRows = [
      { phone_e164: "+17087454219", direction: "inbound", body: "tell me about Majlis 7", created_at: "2026-06-14T05:00:00Z" },
      { phone_e164: "+17087454219", direction: "outbound", body: "*Majlis 7 — Shams*", created_at: "2026-06-14T05:00:02Z" },
    ];
    mocks.userRows = [{ phone_e164: "+17087454219", display_name: "Jumana" }];

    const res = await GET(req("?from=2026-06-14&to=2026-06-14"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("religious-chats-2026-06-14_2026-06-14.html");

    const html = await res.text();
    expect(html).toContain("Jumana");
    expect(html).toContain("tell me about Majlis 7");
    expect(html).toContain("answer_religious_questions");

    // The date range was applied to the queries.
    expect(mocks.gteCalls.some((a) => a[1] === "2026-06-14T00:00:00.000Z")).toBe(true);
    expect(mocks.lteCalls.some((a) => a[1] === "2026-06-14T23:59:59.999Z")).toBe(true);
  });

  it("no religious tool calls → still 200 with an empty transcript", async () => {
    mocks.toolRows = [];
    const res = await GET(req());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No religious / Lisan chats");
  });
});
