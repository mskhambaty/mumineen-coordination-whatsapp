import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePortalCaller: vi.fn(), getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/portal-auth", () => ({ requirePortalCaller: (...a: unknown[]) => mocks.requirePortalCaller(...a) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => mocks.getSupabaseAdmin() }));

import { PUT } from "@/app/api/admin/religious/mode/route";

// Supabase stub: from().update(vals).eq().select().maybeSingle() → { data }.
function supabaseReturning(data: unknown) {
  const update = vi.fn(() => ({
    eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }),
  }));
  return { client: { from: () => ({ update }) }, update };
}
const req = (body: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof PUT>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue({ caller: { user_id: "u1", portal: { role: "admin" } } });
});

describe("PUT /api/admin/religious/mode", () => {
  it("sets handling_mode and attributes it to the caller (no intent/state reset)", async () => {
    const { client, update } = supabaseReturning({ phone_e164: "+1555", handling_mode: "manual", handling_mode_at: "t" });
    mocks.getSupabaseAdmin.mockReturnValue(client);

    const res = await PUT(req({ phone: "+15551234567", mode: "manual" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handling_mode: "manual" });
    const vals = update.mock.calls[0][0] as Record<string, unknown>;
    expect(vals).toMatchObject({ handling_mode: "manual", handling_mode_by: "u1" });
    // State-preserving: never resets the member's in-progress flow.
    expect(vals).not.toHaveProperty("current_intent");
    expect(vals).not.toHaveProperty("state");
  });

  it("rejects an invalid mode with 400", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseReturning(null).client);
    const res = await PUT(req({ phone: "+1555", mode: "sometimes" }));
    expect(res.status).toBe(400);
  });

  it("404s when the conversation doesn't exist", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(supabaseReturning(null).client);
    const res = await PUT(req({ phone: "+15551234567", mode: "ai" }));
    expect(res.status).toBe(404);
  });

  it("denies an unauthorized caller", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const res = await PUT(req({ phone: "+15551234567", mode: "ai" }));
    expect(res.status).toBe(403);
  });
});
