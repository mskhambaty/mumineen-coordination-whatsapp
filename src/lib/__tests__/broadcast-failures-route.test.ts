import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

// Real (pure) categorize logic so the route's grouping/labels are exercised, without importing the
// heavy broadcast module graph (send-template, audience, …).
vi.mock("@/lib/whatsapp/broadcast", () => ({
  categorizeFailure: (e: string | null, w: boolean | null) =>
    e && e.trim() ? e.trim() : w === false ? "Delivery failed (outside 24h window)" : "Delivery failed",
}));
vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => supabase }));

let broadcastRow: unknown = { id: "b1", template_code: "t" };
let failedRecips: unknown[] = [];
let people: unknown[] = [];

// Minimal chainable Supabase stub: maybeSingle() resolves the single-row reads. The recipient list
// read is paged via fetchAllRows → .range(from, to), so it returns a 1000-row window each call;
// awaiting the builder (.then) still resolves the un-paged reads (e.g. the mumineen identity lookup).
const supabase = {
  from: (table: string) => {
    const listData = (): unknown[] =>
      table === "template_broadcast_recipients" ? failedRecips : table === "mumineen" ? people : [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      range: (from: number, to: number) => Promise.resolve({ data: listData().slice(from, to + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: broadcastRow, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: listData(), error: null }).then(resolve),
    };
    return builder;
  },
};

import { GET as failuresGet } from "@/app/api/admin/templates/broadcasts/[id]/failures/route";

const params = Promise.resolve({ id: "b1" });
const req = (url = "http://localhost/api/admin/templates/broadcasts/b1/failures") => new NextRequest(url);

beforeEach(() => {
  vi.clearAllMocks();
  broadcastRow = { id: "b1", template_code: "t" };
  failedRecips = [];
  people = [];
});

describe("broadcast failures route", () => {
  it("denies a non admin/leadership caller (403) and returns no recipient data", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await failuresGet(req(), { params });
    expect(res.status).toBe(403);
    // Body is the auth denial, never a failures payload.
    const json = await res.json();
    expect(json.failures).toBeUndefined();
  });

  it("returns the per-recipient failure list with resolved identity for an admin", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    failedRecips = [
      { phone_e164: "+13125550001", error_detail: "Meta send-template failed with status 400", was_in_window: true },
      { phone_e164: "+13125559999", error_detail: null, was_in_window: false },
    ];
    people = [{ whatsapp_e164: "+13125550001", full_name: "Test Person", its: "12345678" }];

    const res = await failuresGet(req(), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failures).toHaveLength(2);
    expect(json.failures[0]).toMatchObject({ phone: "+13125550001", name: "Test Person", its: "12345678", reason: "Meta send-template failed with status 400" });
    // Unmatched phone → null identity, delivery-status webhook failure bucketed by window.
    expect(json.failures[1]).toMatchObject({ phone: "+13125559999", name: null, its: null, reason: "Delivery failed (outside 24h window)" });
  });

  it("returns a CSV attachment when format=csv", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    failedRecips = [{ phone_e164: "+13125550001", error_detail: "boom", was_in_window: true }];
    people = [{ whatsapp_e164: "+13125550001", full_name: "Test Person", its: "12345678" }];

    const res = await failuresGet(req("http://localhost/x?format=csv"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const body = await res.text();
    expect(body).toContain("Test Person");
    expect(body).toContain("+13125550001");
    expect(body).toContain("boom");
  });

  it("exports every failure past the 1000-row cap (pages, no silent truncation)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    // 1500 distinct failed rows: a single un-paged read caps at PostgREST's 1000-row limit, so a
    // truncated implementation would yield only 1000 CSV data lines.
    failedRecips = Array.from({ length: 1500 }, (_, i) => ({
      phone_e164: `+1312555${String(i).padStart(4, "0")}`,
      error_detail: "boom",
      was_in_window: true,
    }));

    const res = await failuresGet(req("http://localhost/x?format=csv"), { params });
    expect(res.status).toBe(200);
    const body = await res.text();
    // 1 header line + 1500 data lines.
    expect(body.split("\r\n")).toHaveLength(1501);
  });

  it("404s when the broadcast does not exist", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    broadcastRow = null;
    const res = await failuresGet(req(), { params });
    expect(res.status).toBe(404);
  });
});
