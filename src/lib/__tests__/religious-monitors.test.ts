import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: mocks.select }) }),
}));

import { getReligiousMonitorEmails } from "@/lib/knowledge/religious-monitors";

beforeEach(() => vi.clearAllMocks());

describe("getReligiousMonitorEmails", () => {
  it("returns monitors with a trimmed email, deduped by user id, dropping empties", async () => {
    mocks.select.mockResolvedValue({
      data: [
        { user: { id: "u1", display_name: "Mustafa", email: " m@x.com " } },
        { user: { id: "u2", display_name: null, email: null } }, // no email → dropped
        { user: { id: "u1", display_name: "Mustafa", email: "m@x.com" } }, // dup id → dropped
        { user: { id: "u3", display_name: "  ", email: "z@x.com" } },
      ],
      error: null,
    });
    const out = await getReligiousMonitorEmails();
    expect(out).toEqual([
      { name: "Mustafa", email: "m@x.com" },
      { name: "Monitor", email: "z@x.com" }, // blank display_name → fallback
    ]);
  });

  it("returns [] on error (never throws)", async () => {
    mocks.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getReligiousMonitorEmails()).toEqual([]);
  });
});
