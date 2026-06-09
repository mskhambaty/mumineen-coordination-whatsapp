import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { GET } from "@/app/api/admin/mumineen/search/route";

// Two queries hit `mumineen`: the match query terminates in .limit() (returns `matches`); the
// family-expansion query is awaited after .order() (the thenable resolves to `members`). The stub
// returns `members` already in the route's sort order (head first, else eldest first per family).
function stubSupabase({ matches, members }: { matches: unknown[]; members: unknown[] }) {
  function chain() {
    const c = {
      select: () => c,
      eq: () => c,
      or: () => c,
      in: () => c,
      order: () => c,
      limit: () => Promise.resolve({ data: matches, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: members, error: null }).then(resolve),
    };
    return c;
  }
  return { from: () => chain() };
}

function reqFor(q: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/mumineen/search?q=${encodeURIComponent(q)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePortalCaller.mockResolvedValue({ role: "admin" });
});

describe("GET /api/admin/mumineen/search", () => {
  it("expands a non-HOF member lookup to the whole family, acting-head = eldest when no is_head", async () => {
    // Looking up member 102 matches family 100; no member is is_head → eldest (101, age 40) acts as head.
    const matches = [{ hof_its: "100", is_head: false, full_name: "Child Two" }];
    const members = [
      { its: "101", hof_its: "100", is_head: false, age: 40, full_name: "Eldest" },
      { its: "102", hof_its: "100", is_head: false, age: 10, full_name: "Child Two" },
    ];
    getSupabaseAdmin.mockReturnValue(stubSupabase({ matches, members }));

    const json = await (await GET(reqFor("102"))).json();

    expect(json.results.map((r: { its: string }) => r.its)).toEqual(["101", "102"]);
    expect(json.results.find((r: { its: string }) => r.its === "101").is_acting_head).toBe(true);
    expect(json.results.find((r: { its: string }) => r.its === "102").is_acting_head).toBe(false);
  });

  it("uses the real is_head member as acting head when present", async () => {
    const matches = [{ hof_its: "200", is_head: true, full_name: "Head" }];
    const members = [
      { its: "200", hof_its: "200", is_head: true, age: 30, full_name: "Head" },
      { its: "201", hof_its: "200", is_head: false, age: 55, full_name: "Older Spouse" },
    ];
    getSupabaseAdmin.mockReturnValue(stubSupabase({ matches, members }));

    const json = await (await GET(reqFor("200"))).json();

    expect(json.results.find((r: { its: string }) => r.its === "200").is_acting_head).toBe(true);
    expect(json.results.find((r: { its: string }) => r.its === "201").is_acting_head).toBe(false);
  });

  it("returns the auth response when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    getSupabaseAdmin.mockReturnValue(stubSupabase({ matches: [], members: [] }));

    const res = await GET(reqFor("200"));
    expect(res.status).toBe(403);
  });
});
