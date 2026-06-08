import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();
const muminInsert = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { POST } from "@/app/api/admin/mumineen/create/route";

// Chainable stub. Existence lookups terminate in .maybeSingle() (return not-found so
// the route proceeds to insert); inserts terminate in .single() (return the created row).
// The mumineen insert payload is captured so tests can assert what columns are written.
function stubSupabase() {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        delete: () => chain,
        insert(payload: Record<string, unknown>) {
          if (table === "mumineen") {
            muminInsert(payload);
          }
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () =>
          Promise.resolve(
            table === "families"
              ? { data: { id: "fam-1" }, error: null }
              : { data: { its: "30461293", full_name: "Test Head" }, error: null },
          ),
      };
      return chain;
    },
  };
}

function postWith(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/mumineen/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_HEAD = {
  its: "30461293",
  full_name: "Test Head",
  is_head: true,
  gender: "F",
  local_mehman: "Mehman",
  age: 50,
};

describe("POST /api/admin/mumineen/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAdmin.mockReturnValue(stubSupabase());
    requirePortalCaller.mockResolvedValue({ role: "admin" });
  });

  it("creates a head-of-family mumin and never writes the generated is_adult column", async () => {
    const res = await POST(postWith(VALID_HEAD));

    expect(res.status).toBe(201);
    expect(muminInsert).toHaveBeenCalledOnce();
    const payload = muminInsert.mock.calls[0][0] as Record<string, unknown>;
    // Regression: is_adult is `generated always as (age >= 18) stored`. Sending any value
    // (even null) makes Postgres throw 'cannot insert a non-DEFAULT value into column "is_adult"'.
    expect("is_adult" in payload).toBe(false);
    expect(payload.age).toBe(50);
  });

  it("strips a client-supplied is_adult instead of forwarding it to the insert", async () => {
    const res = await POST(postWith({ ...VALID_HEAD, is_adult: true }));

    expect(res.status).toBe(201);
    const payload = muminInsert.mock.calls[0][0] as Record<string, unknown>;
    expect("is_adult" in payload).toBe(false);
  });

  it("returns the auth response when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));

    const res = await POST(postWith(VALID_HEAD));

    expect(res.status).toBe(403);
    expect(muminInsert).not.toHaveBeenCalled();
  });
});
