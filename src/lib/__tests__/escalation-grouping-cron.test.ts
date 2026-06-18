import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clusterUngroupedEscalations = vi.fn();

vi.mock("@/lib/env", () => ({
  requireEnv: () => "test-cron-secret",
}));
vi.mock("@/lib/escalation/issue-grouping", () => ({
  clusterUngroupedEscalations: (...args: unknown[]) => clusterUngroupedEscalations(...args),
}));

import { GET } from "@/app/api/cron/escalation-grouping/route";

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/cron/escalation-grouping", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  clusterUngroupedEscalations.mockResolvedValue({ scanned: 0, issuesCreated: 0, linked: 0 });
});

describe("GET /api/cron/escalation-grouping", () => {
  it("rejects an unauthenticated request and does not run clustering", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(clusterUngroupedEscalations).not.toHaveBeenCalled();
  });

  it("runs clustering with a valid CRON_SECRET bearer token", async () => {
    const res = await GET(req({ authorization: "Bearer test-cron-secret" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(clusterUngroupedEscalations).toHaveBeenCalledTimes(1);
  });
});
