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
import {
  RELIGIOUS_GUIDANCE_RULE,
  RELIGIOUS_FOLLOWUP_REPLY,
  escalationAcknowledgment,
} from "@/lib/agent/run-agent";

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

    // Sermon-content fallback searches the sermon categories (decoration/tazyeen excluded),
    // year-scoped (null = no time cue → most-recent indexed).
    expect(mocks.retrieveReligiousContext).toHaveBeenCalledWith("what is vaaz talaqi", 5, ["reflection", "al_dars", "overview"], null);
    expect(mocks.retrieveSiteContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", decision: "answer", source: "indexed_religious_content" });
  });

  it("reports no match when the religious store is empty", async () => {
    mocks.retrieveReligiousContext.mockResolvedValue("");
    const result = await executeTool(
      "answer_religious_questions",
      { query: "obscure" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(result).toMatchObject({ decision: "not_found" });
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
    // A question the reflections can't answer (incl. personal fiqh) hands off to the
    // team via the escalation queue rather than improvising a ruling.
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("religious_followup");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("move_to_escalation");
  });

  it("requires citing the source (with the blog-link allowance)", () => {
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("Source:");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("blogs.jameasaifiyah.edu");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("Lisan ud Dawat dictionary");
  });

  it("escalation acknowledgment returns the fixed Waaz-scoped reply for religious_followup", () => {
    // A religious_followup hand-off gets the curated reflections-only message (no ruling),
    // distinct from the generic support/urgent acks. This is what the user sees instead of
    // the bogus citations bug.
    expect(escalationAcknowledgment({ category: "religious_followup", priority: "normal" })).toBe(
      RELIGIOUS_FOLLOWUP_REPLY,
    );
    expect(RELIGIOUS_FOLLOWUP_REPLY).toContain("published Ashara reflections");
    expect(RELIGIOUS_FOLLOWUP_REPLY).toContain("Waaz Mubarak");
    // Other categories keep their existing acks.
    expect(escalationAcknowledgment({ category: "registration", priority: "normal" })).not.toBe(
      RELIGIOUS_FOLLOWUP_REPLY,
    );
    expect(escalationAcknowledgment({ priority: "urgent" }).toLowerCase()).toContain("urgent");
  });

  it("instructs WhatsApp formatting (bold/italic/lists) for Waaz Talaqi answers only", () => {
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("BOLD");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("ITALICIZE");
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("SINGLE asterisks");
    expect(RELIGIOUS_GUIDANCE_RULE.toLowerCase()).toContain("list");
    // Still no emojis, and logistics stays plain.
    expect(RELIGIOUS_GUIDANCE_RULE).toContain("never for logistics");
  });
});
