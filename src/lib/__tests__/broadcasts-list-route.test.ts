import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const eq = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ isAdminOrLeadership: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: (...a: unknown[]) => getSupabaseAdmin(...a) }));

import { GET } from "@/app/api/admin/templates/broadcasts/route";

// Chainable, awaitable query stub. Resolves to a fixed result; records .eq() calls.
function chain() {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.eq = (...a: unknown[]) => {
    eq(...a);
    return c;
  };
  c.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "b1", audience_key: "niyaz_rsvp" }], error: null });
  return c;
}

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseAdmin.mockReturnValue({ from: () => chain() });
});

describe("GET /api/admin/templates/broadcasts", () => {
  it("denies an unauthorized caller (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req("http://localhost/api/admin/templates/broadcasts"));
    expect(res.status).toBe(403);
  });

  it("filters by audience_key when provided", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await GET(req("http://localhost/api/admin/templates/broadcasts?audience_key=niyaz_rsvp"));
    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("audience_key", "niyaz_rsvp");
    const json = await res.json();
    expect(json.broadcasts).toHaveLength(1);
  });

  it("does not filter when audience_key is absent", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await GET(req("http://localhost/api/admin/templates/broadcasts"));
    expect(res.status).toBe(200);
    expect(eq).not.toHaveBeenCalled();
  });
});
