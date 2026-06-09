import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDepartmentDigest = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
  date: "2026-06-15",
  departments: 2,
  emails: 5,
  whatsapp: 3,
  errors: [],
}));

// Controls the once-per-day guard: how many summaries already exist for the target date.
let existingSummaries = 0;

vi.mock("@/lib/digest/run", () => ({
  runDepartmentDigest: (...a: unknown[]) => runDepartmentDigest(...a),
}));
vi.mock("@/lib/digest/mine-conversations", () => ({
  mineConversationsForFeedback: vi.fn(async () => ({ conversations: 0, chunks: 0, feedback: 0 })),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(table === "department_daily_summaries" ? { count: existingSummaries } : { data: [] }).then(resolve),
      };
      return b;
    },
  }),
}));

import { GET } from "@/app/api/cron/department-digest/route";

const SECRET = "test-cron-secret";

function req(headers: Record<string, string>, url = "http://localhost/api/cron/department-digest"): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  existingSummaries = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.ADMIN_API_KEY;
});

describe("department-digest cron", () => {
  it("rejects a request without the cron secret or admin key (401)", async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(401);
    expect(runDepartmentDigest).not.toHaveBeenCalled();
  });

  it("runs for an authorized cron call when the day has no summaries yet", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(runDepartmentDigest).toHaveBeenCalledTimes(1);
  });

  it("SKIPS (no re-send) when the day already has summaries", async () => {
    existingSummaries = 5;
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("already_ran_today");
    expect(runDepartmentDigest).not.toHaveBeenCalled();
  });

  it("?force=1 overrides the guard and runs even if summaries exist", async () => {
    existingSummaries = 5;
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }, "http://localhost/api/cron/department-digest?force=1"));
    expect(res.status).toBe(200);
    expect(runDepartmentDigest).toHaveBeenCalledTimes(1);
  });

  it("honors a valid ?date= override", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }, "http://localhost/api/cron/department-digest?date=2026-06-20"));
    expect(res.status).toBe(200);
    expect(runDepartmentDigest).toHaveBeenCalledWith("2026-06-20");
  });
});
