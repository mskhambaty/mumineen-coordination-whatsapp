import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();

// Capture what the route writes to rsvp_registration_instance so we can assert the normalized values.
let insertArg: Record<string, unknown> | null = null;
let updateArg: Record<string, unknown> | null = null;

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessPortal: () => true }));
// getEventTallies is only used by GET; the create/edit tests don't touch it.
vi.mock("@/lib/rsvp/meal-rsvp", () => ({ getEventTallies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      // POST: insert(...).select("id").single()
      insert: (arg: Record<string, unknown>) => {
        insertArg = arg;
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "new-id" }, error: null }) }) };
      },
      // PATCH: update(...).eq(...).select(...).maybeSingle()
      update: (arg: Record<string, unknown>) => {
        updateArg = arg;
        return {
          eq: () => ({
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "e1", ...arg }, error: null }) }),
          }),
        };
      },
    }),
  }),
}));

import { POST } from "@/app/api/admin/niyaz/instances/route";
import { PATCH } from "@/app/api/admin/niyaz/instances/[id]/route";

const params = Promise.resolve({ id: "e1" });

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertArg = null;
  updateArg = null;
  requirePortalCaller.mockResolvedValue(allow());
});

describe("POST /api/admin/niyaz/instances", () => {
  it("denies a non-portal caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await POST(jsonReq("http://localhost/api/admin/niyaz/instances", "POST", { title: "Lunch" }));
    expect(res.status).toBe(403);
    expect(insertArg).toBeNull();
  });

  it("persists thaal_wardi_count and actual_count", async () => {
    const res = await POST(
      jsonReq("http://localhost/api/admin/niyaz/instances", "POST", {
        title: "Lunch thaal",
        thaal_wardi_count: 40,
        actual_count: 37,
      }),
    );
    expect(res.status).toBe(201);
    expect(insertArg).toMatchObject({ thaal_wardi_count: 40, actual_count: 37 });
  });

  it("normalizes a negative or non-numeric count to null", async () => {
    await POST(
      jsonReq("http://localhost/api/admin/niyaz/instances", "POST", {
        title: "Lunch thaal",
        thaal_wardi_count: -5,
        actual_count: "abc",
      }),
    );
    expect(insertArg).toMatchObject({ thaal_wardi_count: null, actual_count: null });
  });
});

describe("PATCH /api/admin/niyaz/instances/[id]", () => {
  it("updates the two counts and floors fractional input", async () => {
    const res = await PATCH(
      jsonReq("http://localhost/api/admin/niyaz/instances/e1", "PATCH", { thaal_wardi_count: 42.9, actual_count: 0 }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(updateArg).toMatchObject({ thaal_wardi_count: 42, actual_count: 0 });
  });

  it("leaves the counts untouched when not provided", async () => {
    await PATCH(jsonReq("http://localhost/api/admin/niyaz/instances/e1", "PATCH", { title: "Renamed" }), { params });
    expect(updateArg).toMatchObject({ title: "Renamed" });
    expect(updateArg).not.toHaveProperty("thaal_wardi_count");
    expect(updateArg).not.toHaveProperty("actual_count");
  });
});
