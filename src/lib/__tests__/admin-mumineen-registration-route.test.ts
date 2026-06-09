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

import { POST } from "@/app/api/admin/mumineen/registration/route";

// Chainable stub. The families SELECT terminates in .maybeSingle(); the mumineen and families
// UPDATE chains are awaited directly, so the chain is thenable and resolves to {error}. Update
// payloads + the rpc call are captured for assertions.
type StubOpts = {
  family?: { id: string; registration_status: string | null } | null;
  memberError?: { message: string } | null;
  famError?: { message: string } | null;
  rpcError?: { message: string } | null;
};

function stubSupabase(opts: StubOpts = {}) {
  const { family = { id: "fam-1", registration_status: "not_started" }, memberError = null, famError = null, rpcError = null } = opts;
  const calls: {
    memberUpdate?: Record<string, unknown>;
    famUpdate?: Record<string, unknown>;
    rpc?: { name: string; args: unknown };
    deletedFrom?: string;
  } = {};
  function makeChain(table: string) {
    const chain = {
      select: () => makeChain(table),
      update(payload: Record<string, unknown>) {
        if (table === "mumineen") calls.memberUpdate = payload;
        else if (table === "families") calls.famUpdate = payload;
        return makeChain(table);
      },
      delete() {
        calls.deletedFrom = table;
        return makeChain(table);
      },
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: family, error: null }),
      then(resolve: (v: { error: unknown }) => unknown) {
        const error = table === "mumineen" ? memberError : famError;
        return Promise.resolve({ error }).then(resolve);
      },
    };
    return chain;
  }
  return {
    from: (table: string) => makeChain(table),
    rpc: (name: string, args: unknown) => {
      calls.rpc = { name, args };
      return Promise.resolve({ error: rpcError });
    },
    __calls: calls,
  };
}

function postWith(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/mumineen/registration", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/mumineen/registration — not_attending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePortalCaller.mockResolvedValue({ role: "admin" });
  });

  it("marks all members not attending, registers the family, and seeds Niyaz RSVP", async () => {
    const stub = stubSupabase({ family: { id: "fam-1", registration_status: "not_started" } });
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "30461293", action: "not_attending" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("submitted");
    expect(stub.__calls.memberUpdate?.not_attending).toBe(true);
    expect(stub.__calls.famUpdate?.registration_status).toBe("submitted");
    expect(stub.__calls.rpc?.name).toBe("seed_family_niyaz_rsvp");
    expect((stub.__calls.rpc?.args as { p_family_id: string }).p_family_id).toBe("fam-1");
  });

  it("returns the auth response and writes nothing when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    const stub = stubSupabase();
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "30461293", action: "not_attending" }));

    expect(res.status).toBe(403);
    expect(stub.__calls.memberUpdate).toBeUndefined();
  });

  it("rejects with 409 and writes nothing when the family is already registered", async () => {
    const stub = stubSupabase({ family: { id: "fam-1", registration_status: "submitted" } });
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "30461293", action: "not_attending" }));

    expect(res.status).toBe(409);
    expect(stub.__calls.memberUpdate).toBeUndefined();
  });
});

describe("POST /api/admin/mumineen/registration — unregister", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePortalCaller.mockResolvedValue({ role: "admin" });
  });

  it("resets a registered family to pending, clears details + not_attending, and deletes RSVP rows", async () => {
    const stub = stubSupabase({ family: { id: "fam-1", registration_status: "submitted" } });
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "30461293", action: "unregister" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("not_started");
    expect(stub.__calls.memberUpdate?.not_attending).toBe(false);
    expect(stub.__calls.famUpdate?.registration_status).toBe("not_started");
    expect(stub.__calls.famUpdate?.acc_type).toBeNull();
    expect(stub.__calls.famUpdate?.submitted_at).toBeNull();
    expect(stub.__calls.deletedFrom).toBe("niyaz_rsvp");
  });

  it("404s when the family does not exist", async () => {
    const stub = stubSupabase({ family: null });
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "999", action: "unregister" }));

    expect(res.status).toBe(404);
    expect(stub.__calls.memberUpdate).toBeUndefined();
  });

  it("returns the auth response when the caller is not permitted", async () => {
    requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    const stub = stubSupabase({ family: { id: "fam-1", registration_status: "submitted" } });
    getSupabaseAdmin.mockReturnValue(stub);

    const res = await POST(postWith({ hof_its: "30461293", action: "unregister" }));

    expect(res.status).toBe(403);
    expect(stub.__calls.memberUpdate).toBeUndefined();
  });
});
