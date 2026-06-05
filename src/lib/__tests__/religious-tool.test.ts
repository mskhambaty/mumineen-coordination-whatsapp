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

import { executeTool, allToolDefinitions } from "@/lib/agent/tools";
import { canUseTool, publicTools } from "@/lib/permissions";
import { RELIGIOUS_GUIDANCE_RULE } from "@/lib/agent/run-agent";

const visitor = { id: "u1", phone_e164: "+1555", role: "visitor" as const, status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordToolAudit.mockResolvedValue(undefined);
});

describe("answer_religious_questions tool", () => {
  it("is registered as a tool definition", () => {
    const names = allToolDefinitions.map((t) => (t.type === "function" ? t.function.name : ""));
    expect(names).toContain("answer_religious_questions");
  });

  it("is a public tool available to visitors (external) and committee/admin (internal)", () => {
    expect(publicTools.has("answer_religious_questions")).toBe(true);
    expect(canUseTool(visitor, "answer_religious_questions")).toBe(true);
    expect(canUseTool({ role: "committee", status: "active" }, "answer_religious_questions")).toBe(true);
  });

  it("registers get_lisan_word_meaning as a public dictionary tool", () => {
    const names = allToolDefinitions.map((t) => (t.type === "function" ? t.function.name : ""));
    expect(names).toContain("get_lisan_word_meaning");
    expect(publicTools.has("get_lisan_word_meaning")).toBe(true);
    expect(canUseTool(visitor, "get_lisan_word_meaning")).toBe(true);
  });

  it("falls back to the religious vector store for non-majlis questions", async () => {
    // A query that names no specific majlis takes the vector path (findMajlisReflection
    // returns [] before touching the DB, so no supabase mock is needed here).
    mocks.retrieveReligiousContext.mockResolvedValue("[Vaaz Talaqi]\n...");

    const result = await executeTool(
      "answer_religious_questions",
      { query: "what is vaaz talaqi" },
      { user: visitor, phoneE164: "+1555" },
    );

    expect(mocks.retrieveReligiousContext).toHaveBeenCalledWith("what is vaaz talaqi", 5);
    expect(mocks.retrieveSiteContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", source: "indexed_religious_content" });
  });

  it("reports no match when the religious store is empty", async () => {
    mocks.retrieveReligiousContext.mockResolvedValue("");
    const result = await executeTool(
      "answer_religious_questions",
      { query: "obscure" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(result).toMatchObject({ status: "no_indexed_match" });
  });
});

describe("RELIGIOUS_GUIDANCE_RULE", () => {
  it("routes religious questions to the tool and enforces the guardrails", () => {
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("answer_religious_questions");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("Iqtibasaat");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("verbatim");
    expect(RELIGIOUS_GUIDANCE_RULE.toLowerCase()).toContain("fatwa");
  });

  it("routes Tazyeen/decoration questions to the religious tool and guards Lisan word precision", () => {
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("Tazyeen");
    expect(RELIGIOUS_GUIDANCE_RULE.toLowerCase()).toContain("decoration");
    // Lisan word lookups route to the exact-lookup tool and never substitute a near word.
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("get_lisan_word_meaning");
    expect(RELIGIOUS_GUIDANCE_RULE.toLowerCase()).toContain("substitute");
    // Out-of-scope redirect names a concrete path.
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("Aamil Saheb");
  });
});
