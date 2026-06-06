import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminOrLeadership, canViewRegistrations } from "@/lib/admin/access";
import { signSessionToken } from "@/lib/admin/session-token";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock }),
}));

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/admin/test", { headers });
}

describe("requirePortalCaller", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-for-unit-tests";
    process.env.ADMIN_API_KEY = "server-key";
    rpcMock.mockReset();
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_API_KEY;
  });

  it("401s with no credentials (regression: shared-key removal)", async () => {
    const result = await requirePortalCaller(reqWith({}), isAdminOrLeadership);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("401s with a tampered cookie", async () => {
    const result = await requirePortalCaller(
      reqWith({ cookie: "portal_session=forged.token" }),
      isAdminOrLeadership,
    );
    expect((result as NextResponse).status).toBe(401);
  });

  it("500s (not 401) when the permissions RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db unavailable" } });
    const cookie = `portal_session=${signSessionToken("u1")}`;
    const result = await requirePortalCaller(reqWith({ cookie }), isAdminOrLeadership);
    expect((result as NextResponse).status).toBe(500);
  });

  it("403s when the session role fails the predicate", async () => {
    rpcMock.mockResolvedValue({
      data: {
        user_id: "u1", display_name: "Member", role: "committee", global_role: "member",
        can_read_all: false, can_write_all: false,
        departments: [{ department_id: "d1", department_name: "Mawaid", dept_role: "member" }],
        is_escalation_support: false, is_master_admin: false,
      },
      error: null,
    });
    const cookie = `portal_session=${signSessionToken("u1")}`;
    const result = await requirePortalCaller(reqWith({ cookie }), isAdminOrLeadership);
    expect((result as NextResponse).status).toBe(403);
  });

  it("passes a session that satisfies the predicate", async () => {
    rpcMock.mockResolvedValue({
      data: {
        user_id: "u1", display_name: "Member", role: "committee", global_role: "member",
        can_read_all: false, can_write_all: false,
        departments: [{ department_id: "d1", department_name: "Mawaid", dept_role: "member" }],
        is_escalation_support: false, is_master_admin: false,
      },
      error: null,
    });
    const cookie = `portal_session=${signSessionToken("u1")}`;
    const result = await requirePortalCaller(reqWith({ cookie }), canViewRegistrations);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { caller: { user_id: string } }).caller.user_id).toBe("u1");
  });

  it("x-admin-key passes every predicate (server-to-server)", async () => {
    const result = await requirePortalCaller(reqWith({ "x-admin-key": "server-key" }), isAdminOrLeadership);
    expect(result).not.toBeInstanceOf(NextResponse);
  });
});
