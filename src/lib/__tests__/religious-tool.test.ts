import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveReligiousContext: vi.fn(),
  retrieveSiteContext: vi.fn(),
  recordToolAudit: vi.fn(),
  availableFacets: vi.fn(),
  findMajlisForRef: vi.fn(),
  latestPublishedReflection: vi.fn(),
  majlisRowForToday: vi.fn(),
}));

vi.mock("@/lib/scraper/retrieve-site-context", () => ({
  retrieveReligiousContext: mocks.retrieveReligiousContext,
  retrieveSiteContext: mocks.retrieveSiteContext,
  RELIGIOUS_FALLBACK_MIN_SCORE: 0.4,
}));

vi.mock("@/lib/supabase/server", () => ({
  recordToolAudit: mocks.recordToolAudit,
  getSupabaseAdmin: vi.fn(),
}));

// Keep the real religious-topics helpers (parseMajlisRef, isOverviewQuery, isSummaryQuery, …) but
// stub the DB-backed ones so the today/facets/summary paths are testable without Supabase.
vi.mock("@/lib/knowledge/religious-topics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge/religious-topics")>();
  return {
    ...actual,
    availableFacets: mocks.availableFacets,
    findMajlisForRef: mocks.findMajlisForRef,
    latestPublishedReflection: mocks.latestPublishedReflection,
  };
});

// Keep the real config (resolveAsharaYear, ASHARA_ROWS, year constants) but stub majlisRowForToday
// so "today → current majlis" is deterministic regardless of the wall-clock date.
vi.mock("@/lib/knowledge/ashara-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge/ashara-config")>();
  return { ...actual, majlisRowForToday: mocks.majlisRowForToday };
});

import { executeTool, allToolDefinitions } from "@/lib/agent/tools";
import { ACTIVE_ASHARA_YEAR } from "@/lib/knowledge/ashara-config";
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
  // Safe defaults (clearAllMocks doesn't reset implementations) so each test sets only what it needs.
  mocks.availableFacets.mockResolvedValue([]);
  mocks.findMajlisForRef.mockResolvedValue([]);
  mocks.latestPublishedReflection.mockResolvedValue(null);
  mocks.majlisRowForToday.mockReturnValue(null);
  mocks.retrieveReligiousContext.mockResolvedValue("");
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

    // Sermon-content fallback searches the sermon categories + the curated Q&A bucket
    // (decoration/tazyeen excluded). F1: a no-cue query during the active Ashara scopes to the
    // ACTIVE year (not null/cross-year). F3: the curated 'faq' is preferred via the 6th arg.
    expect(mocks.retrieveReligiousContext).toHaveBeenCalledWith(
      "what is vaaz talaqi", 5, ["reflection", "al_dars", "overview", "faq"], ACTIVE_ASHARA_YEAR, 0.4, "faq",
    );
    expect(mocks.retrieveSiteContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", decision: "answer", source: "indexed_religious_content" });
  });

  it("F1: scopes to the explicit year when the query names one", async () => {
    mocks.retrieveReligiousContext.mockResolvedValue("[Reflections — Ashara 1447H, Majlis 1]\n…");
    await executeTool(
      "answer_religious_questions",
      { query: "what was the reflection about in 1447" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(mocks.retrieveReligiousContext).toHaveBeenCalledWith(
      expect.any(String), 5, expect.any(Array), "1447", 0.4, "faq",
    );
  });

  it("Fix Y: no 1447 fallback when the active year has no match (not_found, never retries 1447)", async () => {
    // No cue → defaults to the active year. No 1448 match → NOT_FOUND. The tool must NOT retry 1447.
    mocks.retrieveReligiousContext.mockResolvedValue("");
    const result = await executeTool(
      "answer_religious_questions",
      { query: "tell me about the reflection" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(result).toMatchObject({ decision: "not_found" });
    expect(mocks.retrieveReligiousContext).toHaveBeenCalledTimes(1); // no second (1447) retrieval
  });

  it("F2: returns available_facets derived from the leading vector chunk", async () => {
    mocks.retrieveReligiousContext.mockResolvedValue(
      "[Reflections — Ashara 1448H, Majlis 2 — Source: https://x]\nThe theme was discernment.",
    );
    mocks.availableFacets.mockResolvedValue(["tazyeen"]);
    const result = await executeTool(
      "answer_religious_questions",
      { query: "what was discussed about discernment" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(mocks.availableFacets).toHaveBeenCalledWith(expect.objectContaining({ majlisNum: 2, year: "1448" }));
    expect(result).toMatchObject({ decision: "answer", available_facets: ["tazyeen"] });
  });

  it("Fix T: 'today's waaz' resolves to the current majlis (not a vector guess)", async () => {
    mocks.majlisRowForToday.mockReturnValue(4); // ASHARA_ROWS[4] = Majlis 5
    mocks.findMajlisForRef.mockResolvedValue([
      { title: "Reflections — Ashara 1448H, Majlis 5", content: "today's content", source_url: null, theme: null, year_hijri: "1448" },
    ]);
    const result = await executeTool(
      "answer_religious_questions",
      { query: "what was today's waaz about" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(mocks.findMajlisForRef).toHaveBeenCalledWith(expect.objectContaining({ majlisNum: 5, year: ACTIVE_ASHARA_YEAR }));
    expect(result).toMatchObject({ decision: "answer", source: "religious_topic_exact", year: ACTIVE_ASHARA_YEAR });
    expect(mocks.retrieveReligiousContext).not.toHaveBeenCalled(); // deterministic, no vector guess
  });

  it("Fix T: today's majlis not posted yet → notice + latest published majlis (never 1447)", async () => {
    mocks.majlisRowForToday.mockReturnValue(4); // Majlis 5
    mocks.findMajlisForRef.mockResolvedValue([]); // today's not indexed yet
    mocks.latestPublishedReflection.mockResolvedValue({
      title: "Reflections — Ashara 1448H, Majlis 4", content: "latest content", source_url: null, theme: null, year_hijri: "1448",
    });
    const result = await executeTool(
      "answer_religious_questions",
      { query: "today's waaz" },
      { user: visitor, phoneE164: "+1555" },
    ) as { decision: string; notice?: string; year?: string };
    expect(result.decision).toBe("answer");
    expect(result.year).toBe(ACTIVE_ASHARA_YEAR);
    expect(result.notice).toMatch(/isn't posted yet/i);
    expect(mocks.latestPublishedReflection).toHaveBeenCalledWith(ACTIVE_ASHARA_YEAR);
  });

  it("Fix S: a summary ask gets answer_style 'summary'", async () => {
    mocks.findMajlisForRef.mockResolvedValue([
      { title: "Reflections — Ashara 1448H, Majlis 4", content: "m4", source_url: null, theme: null, year_hijri: "1448" },
    ]);
    const result = await executeTool(
      "answer_religious_questions",
      { query: "give me a summary of majlis 4" },
      { user: visitor, phoneE164: "+1555" },
    ) as { answer_style?: string };
    expect(result.answer_style).toBe("summary");
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

  it("routes a bare word-meaning to the dictionary (decision word_lookup), not a sermon", async () => {
    const result = await executeTool(
      "answer_religious_questions",
      { query: "meaning of shadi" },
      { user: visitor, phoneE164: "+1555" },
    );
    expect(result).toMatchObject({ decision: "word_lookup", word: "shadi" });
    expect(mocks.retrieveReligiousContext).not.toHaveBeenCalled(); // never reached the vector path
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
