import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortalUser } from "@/lib/admin/access";

// The caller returned by requirePortalCaller is swapped per test.
const callerRef: { current: { portal: PortalUser; user_id: string } } = {
  current: { portal: { role: "committee", global_role: "member" }, user_id: "caller-1" },
};

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: vi.fn(async () => ({ caller: callerRef.current })),
}));

// Minimal chainable Supabase stub. `single`/`maybeSingle` return the target row;
// awaiting a builder directly (the head:true count query) yields a non-zero count
// so the last-admin guard never trips, and insert/update resolve successfully.
const targetRow: { current: { id: string; role: string; global_role: string } } = {
  current: { id: "target-1", role: "committee", global_role: "member" },
};

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "or", "update", "insert", "order", "limit"]) {
    c[m] = () => c;
  }
  c.single = async () => ({ data: targetRow.current, error: null });
  c.maybeSingle = async () => ({ data: targetRow.current, error: null });
  // `await builder` (count head query) → pretend other admins exist.
  c.then = (resolve: (v: unknown) => void) => resolve({ count: 2, error: null });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => chain() }),
}));

import { PUT } from "@/app/api/admin/users/[id]/route";
import { POST } from "@/app/api/admin/users/route";

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/users/target-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "target-1" }) };

describe("admin-promotion guard", () => {
  beforeEach(() => {
    callerRef.current = { portal: { role: "committee", global_role: "member" }, user_id: "caller-1" };
    targetRow.current = { id: "target-1", role: "committee", global_role: "member" };
  });

  it("blocks a committee caller from promoting a user to admin (PUT)", async () => {
    const res = (await PUT(putReq({ role: "admin" }), params)) as NextResponse;
    expect(res.status).toBe(403);
  });

  it("blocks a committee caller from setting global_role leadership_admin (PUT)", async () => {
    const res = (await PUT(putReq({ global_role: "leadership_admin" }), params)) as NextResponse;
    expect(res.status).toBe(403);
  });

  it("blocks a committee caller from modifying an existing admin (PUT)", async () => {
    targetRow.current = { id: "target-1", role: "admin", global_role: "leadership_admin" };
    const res = (await PUT(putReq({ display_name: "x" }), params)) as NextResponse;
    expect(res.status).toBe(403);
  });

  it("blocks a committee caller from creating an admin user (POST)", async () => {
    const res = (await POST(postReq({ display_name: "A", phone_e164: "+1", role: "admin" }))) as NextResponse;
    expect(res.status).toBe(403);
  });

  it("allows a committee caller to edit a non-admin user's display name (PUT)", async () => {
    const res = (await PUT(putReq({ display_name: "New Name" }), params)) as NextResponse;
    expect(res.status).not.toBe(403);
  });

  it("allows an admin caller to promote a user to admin (PUT)", async () => {
    callerRef.current = { portal: { role: "admin", global_role: "leadership_admin" }, user_id: "caller-1" };
    const res = (await PUT(putReq({ role: "admin" }), params)) as NextResponse;
    expect(res.status).not.toBe(403);
  });
});
