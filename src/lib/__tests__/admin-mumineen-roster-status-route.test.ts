import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();
const familyUpdate = vi.fn();
const muminUpdate = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { POST } from "@/app/api/admin/mumineen/roster-status/route";

// Chainable stub. The family-existence lookup terminates in .maybeSingle(); the two UPDATEs and
// the members re-read are awaited directly (chain is thenable). UPDATE payloads are captured per
// table so tests can assert what roster_active value is written.
function stubSupabase(opts: { family?: unknown; members?: unknown[] } = {}) {
  return {
    from(table: string) {
      const ctx: { op: "select" | "update" | null } = { op: null };
      const chain = {
        select() {
          ctx.op = "select";
          return chain;
        },
        update(payload: Record<string, unknown>) {
          ctx.op = "update";
          if (table === "families") familyUpdate(payload);
          if (table === "mumineen") muminUpdate(payload);
          return chain;
        },
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: "family" in opts ? opts.family : { id: "fam-1", hof_its: "30461285" },
            error: null,
          }),
        // Terminal await for the two UPDATEs and the members re-read SELECT.
        then(resolve: (v: unknown) => unknown) {
          if (ctx.op === "select") return resolve({ data: opts.members ?? [], error: null });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  };
}

function postWith(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/mumineen/roster-status", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/mumineen/roster-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAdmin.mockReturnValue(stubSupabase());
    requirePortalCaller.mockResolvedValue({ caller: { portal: { role: "admin" } } });
  });

  it("activates the family and all its members", async () => {
    const res = await POST(postWith({ hof_its: "30461285", active: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.active).toBe(true);
    expect(familyUpdate).toHaveBeenCalledOnce();
    expect(muminUpdate).toHaveBeenCalledOnce();
    expect((familyUpdate.mock.calls[0][0] as Record<string, unknown>).roster_active).toBe(true);
    expect((muminUpdate.mock.calls[0][0] as Record<string, unknown>).roster_active).toBe(true);
  });

  it("deactivates the family and all its members", async () => {
    const res = await POST(postWith({ hof_its: "30461285", active: false }));

    expect(res.status).toBe(200);
    expect((familyUpdate.mock.calls[0][0] as Record<string, unknown>).roster_active).toBe(false);
    expect((muminUpdate.mock.calls[0][0] as Record<string, unknown>).roster_active).toBe(false);
  });

  it("returns 404 and writes nothing when the family does not exist", async () => {
    getSupabaseAdmin.mockReturnValue(stubSupabase({ family: null }));

    const res = await POST(postWith({ hof_its: "999999", active: true }));

    expect(res.status).toBe(404);
    expect(familyUpdate).not.toHaveBeenCalled();
    expect(muminUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 and writes nothing for an invalid body (missing active)", async () => {
    const res = await POST(postWith({ hof_its: "30461285" }));

    expect(res.status).toBe(400);
    expect(familyUpdate).not.toHaveBeenCalled();
  });

  it("returns the auth response and writes nothing when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

    const res = await POST(postWith({ hof_its: "30461285", active: true }));

    expect(res.status).toBe(403);
    expect(familyUpdate).not.toHaveBeenCalled();
    expect(muminUpdate).not.toHaveBeenCalled();
  });
});
