import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { GET } from "@/app/api/admin/department-digest/route";

const SUMMARY_ROWS = [
  { department_id: null, ai_briefing: "all up", ai_briefing_short: "x", metrics: {}, departments: null },
  { department_id: "d1", ai_briefing: "parking", ai_briefing_short: "p", metrics: {}, departments: { name: "Parking" } },
  { department_id: "d2", ai_briefing: "mawaid", ai_briefing_short: "m", metrics: {}, departments: { name: "Mawaid" } },
];

const DATE_ROWS = [{ summary_date: "2026-06-15" }];
const DEPTS = [
  { id: "d1", name: "Parking" },
  { id: "d2", name: "Mawaid" },
];

// Chainable thenable stub: resolves based on table + whether a summary_date eq was used.
function stubSupabase(rows: unknown[]) {
  function from(table: string) {
    const state = { hadSummaryDateEq: false };
    const b = {
      select: () => b,
      eq: (col: string) => {
        if (col === "summary_date") state.hadSummaryDateEq = true;
        return b;
      },
      order: () => b,
      in: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: null }),
      then: (resolve: (v: { data: unknown[] }) => unknown) => {
        const data = table === "departments" ? DEPTS : state.hadSummaryDateEq ? rows : DATE_ROWS;
        return Promise.resolve({ data }).then(resolve);
      },
    };
    return b;
  }
  return { from };
}

function callerWith(portal: Record<string, unknown>, departments: { department_id: string; department_name: string; dept_role: string }[]) {
  return { caller: { user_id: "u1", portal, departments } };
}

const req = () => new NextRequest("http://localhost/api/admin/department-digest?date=2026-06-15");

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseAdmin.mockReturnValue(stubSupabase(SUMMARY_ROWS));
});

describe("GET /api/admin/department-digest scoping", () => {
  it("a plain department member sees only their own department (no all-up, no other depts)", async () => {
    requirePortalCaller.mockResolvedValue(
      callerWith({ role: "committee", global_role: "member" }, [{ department_id: "d1", department_name: "Parking", dept_role: "member" }]),
    );
    const res = await GET(req());
    const json = await res.json();
    expect(json.sees_all).toBe(false);
    const names = json.summaries.map((s: { department_name: string }) => s.department_name);
    expect(names).toEqual(["Parking"]);
  });

  it("a Leadership-department member sees all departments plus the all-up", async () => {
    requirePortalCaller.mockResolvedValue(
      callerWith({ role: "committee", global_role: "member" }, [{ department_id: "dx", department_name: "Leadership", dept_role: "member" }]),
    );
    const res = await GET(req());
    const json = await res.json();
    expect(json.sees_all).toBe(true);
    expect(json.summaries).toHaveLength(3);
    expect(json.summaries[0].department_id).toBeNull(); // all-up sorted first
  });

  it("an admin/leadership-role caller sees everything", async () => {
    requirePortalCaller.mockResolvedValue(callerWith({ role: "admin", global_role: "leadership_admin" }, []));
    const res = await GET(req());
    const json = await res.json();
    expect(json.sees_all).toBe(true);
    expect(json.summaries).toHaveLength(3);
  });
});
