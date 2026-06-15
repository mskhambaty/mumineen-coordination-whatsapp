import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const allow = () => ({ caller: { user_id: "u1" } });

const requirePortalCaller = vi.fn();
const getSupabaseAdmin = vi.fn();
const getBroadcastAccount = vi.fn();

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => requirePortalCaller(...a) }));
vi.mock("@/lib/admin/access", () => ({ canAccessInbox: () => true }));
vi.mock("@/lib/admin/conversations", () => ({
  countUnreadInbound: () => 0,
  groupRowsByPhoneChronologically: () => new Map(),
}));
vi.mock("@/lib/admin/religious-transcript", () => ({ RELIGIOUS_TOOL_NAMES: [] }));
vi.mock("@/lib/whatsapp/accounts", () => ({ getBroadcastAccount: (...a: unknown[]) => getBroadcastAccount(...a) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: (...a: unknown[]) => getSupabaseAdmin(...a) }));

import { GET } from "@/app/api/admin/conversations/route";

// Chainable, awaitable query stub recording .or()/.eq() calls; resolves to empty (so the route returns
// `{ conversations: [] }` early, before the message/tool queries).
let orCalls: string[] = [];
let eqCalls: [string, string][] = [];
function builder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.eq = (c: string, v: string) => { eqCalls.push([c, v]); return b; };
  b.or = (f: string) => { orCalls.push(f); return b; };
  b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return b;
}

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  orCalls = [];
  eqCalls = [];
  getSupabaseAdmin.mockReturnValue({ from: () => builder() });
  getBroadcastAccount.mockReturnValue({ label: "broadcast", phoneNumberId: "608521205670333" });
});

describe("GET /api/admin/conversations scope", () => {
  it("denies unauthorized (403)", async () => {
    requirePortalCaller.mockResolvedValue(deny());
    const res = await GET(req("http://localhost/api/admin/conversations"));
    expect(res.status).toBe(403);
  });

  it("main scope excludes the broadcast number (or filter)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await GET(req("http://localhost/api/admin/conversations"));
    expect(res.status).toBe(200);
    expect(orCalls).toContain("phone_number_id.is.null,phone_number_id.neq.608521205670333");
    expect(eqCalls).not.toContainEqual(["phone_number_id", "608521205670333"]);
  });

  it("niyaz scope filters to only the broadcast number (eq filter)", async () => {
    requirePortalCaller.mockResolvedValue(allow());
    const res = await GET(req("http://localhost/api/admin/conversations?scope=niyaz"));
    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(["phone_number_id", "608521205670333"]);
    expect(orCalls).toHaveLength(0);
  });
});
