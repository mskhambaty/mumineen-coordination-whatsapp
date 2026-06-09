import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveReligiousContext: vi.fn(),
  retrieveSiteContext: vi.fn(),
  recordToolAudit: vi.fn(),
}));

vi.mock("@/lib/scraper/retrieve-site-context", () => ({
  retrieveReligiousContext: mocks.retrieveReligiousContext,
  retrieveSiteContext: mocks.retrieveSiteContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  recordToolAudit: mocks.recordToolAudit,
  getSupabaseAdmin: vi.fn(),
}));

import { executeTool } from "@/lib/agent/tools";

const visitor = { id: "u1", phone_e164: "+1555", role: "visitor" as const, status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordToolAudit.mockResolvedValue(undefined);
});

describe("get_site_content_faq tool", () => {
  // Regression: the curated FAQ (e.g. the one-chunk "WiFi access" answer) was being crowded
  // out of a top-5 retrieval window by generic chunks, so the agent denied having info that
  // was indexed. The tool must request a top-10 window so the specific FAQ reaches the model.
  it("retrieves a top-10 window (not top-5) so buried FAQ chunks surface", async () => {
    mocks.retrieveSiteContext.mockResolvedValue("[WiFi access]\nConnect to ASC-GuestWifi...");

    const result = await executeTool(
      "get_site_content_faq",
      { query: "what is the wifi password" },
      { user: visitor, phoneE164: "+1555" },
    );

    expect(mocks.retrieveSiteContext).toHaveBeenCalledWith("what is the wifi password", 10);
    expect(result).toMatchObject({ status: "ok", source: "indexed_site_content" });
    expect((result as { context: string }).context).toContain("ASC-GuestWifi");
  });

  it("returns no_indexed_match when retrieval is empty", async () => {
    mocks.retrieveSiteContext.mockResolvedValue("");

    const result = await executeTool(
      "get_site_content_faq",
      { query: "something not indexed" },
      { user: visitor, phoneE164: "+1555" },
    );

    expect(result).toMatchObject({ status: "no_indexed_match" });
  });
});
