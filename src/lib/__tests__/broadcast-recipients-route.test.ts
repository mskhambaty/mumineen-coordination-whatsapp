import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for the audience-export route: the FULL recipient list (every send status) must be
// exported, not silently truncated at PostgREST's 1000-row cap. A bare await (no .range()) returned
// only the first 1000 of e.g. 1858 recipients; the route now pages via fetchAllRows.

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

vi.mock("@/lib/whatsapp/broadcast", () => ({
  categorizeFailure: (e: string | null, w: boolean | null) =>
    e && e.trim() ? e.trim() : w === false ? "Delivery failed (outside 24h window)" : "Delivery failed",
}));
vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => supabase }));

// Keep fetchAllRows / normalizePhone / Pageable real (they drive the paging under test); only stub
// the roster lookup so the test needs no DB.
vi.mock("@/lib/whatsapp/audience", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/audience")>();
  return { ...actual, resolveRosterByPhone: vi.fn(async () => new Map()) };
});

let broadcastRow: unknown = { id: "b1", template_code: "t" };
let recips: unknown[] = [];

// Chainable Supabase stub: maybeSingle() resolves the broadcast lookup; the recipient list is paged
// via fetchAllRows → .range(from, to), returning a 1000-row window each call.
const supabase = {
  from: () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from: number, to: number) => Promise.resolve({ data: (recips as unknown[]).slice(from, to + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: broadcastRow, error: null }),
    };
    return builder;
  },
};

import { GET as recipientsGet } from "@/app/api/admin/templates/broadcasts/[id]/recipients/route";

const params = Promise.resolve({ id: "b1" });
const req = (url = "http://localhost/api/admin/templates/broadcasts/b1/recipients") => new NextRequest(url);

beforeEach(() => {
  vi.clearAllMocks();
  broadcastRow = { id: "b1", template_code: "t" };
  recips = [];
});

describe("broadcast recipients (audience export) route", () => {
  it("denies a non admin/leadership caller (403) and returns no recipient data", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await recipientsGet(req(), { params });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.recipients).toBeUndefined();
  });

  it("exports every recipient past the 1000-row cap (pages, no silent truncation)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    // 1858 recipients — the real-world case where the CSV came back with only 1000 rows.
    recips = Array.from({ length: 1858 }, (_, i) => ({
      phone_e164: `+1312555${String(i).padStart(4, "0")}`,
      send_status: "sent",
      error_detail: null,
      skip_reason: null,
      was_in_window: true,
      sent_at: "2026-06-16T00:00:00Z",
    }));

    const res = await recipientsGet(req("http://localhost/x?format=csv"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const body = await res.text();
    // 1 header line + 1858 data lines.
    expect(body.split("\r\n")).toHaveLength(1859);
  });
});
