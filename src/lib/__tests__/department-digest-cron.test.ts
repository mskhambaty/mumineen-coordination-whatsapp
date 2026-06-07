import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDepartmentDigest = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
  date: "2026-06-15",
  departments: 2,
  emails: 5,
  whatsapp: 3,
  errors: [],
}));

vi.mock("@/lib/digest/run", () => ({
  runDepartmentDigest: (...a: unknown[]) => runDepartmentDigest(...a),
}));

import { GET } from "@/app/api/cron/department-digest/route";

const SECRET = "test-cron-secret";

function req(headers: Record<string, string>, url = "http://localhost/api/cron/department-digest"): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.ADMIN_API_KEY;
});

describe("department-digest cron auth", () => {
  it("rejects a request without the cron secret or admin key (401)", async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(401);
    expect(runDepartmentDigest).not.toHaveBeenCalled();
  });

  it("runs for an authorized cron call and defaults the date", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(runDepartmentDigest).toHaveBeenCalledTimes(1);
  });

  it("honors a valid ?date= override", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }, "http://localhost/api/cron/department-digest?date=2026-06-20"));
    expect(res.status).toBe(200);
    expect(runDepartmentDigest).toHaveBeenCalledWith("2026-06-20");
  });
});
