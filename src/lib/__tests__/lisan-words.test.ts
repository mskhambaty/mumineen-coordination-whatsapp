import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { normalizeWord, lookupLisanWord } from "@/lib/knowledge/lisan-words";

type Row = { transliteration: string | null; lisan: string | null; meaning: string | null; example: string | null };

// Wire the supabase mock: .eq("norm",…) → exactData, .eq("norm_skeleton",…) → skelData,
// .ilike() → arabicData, .rpc() → suggData.
function wire(
  { exactData = [], skelData = [], arabicData = [], suggData = [] }:
    { exactData?: Row[]; skelData?: Row[]; arabicData?: Row[]; suggData?: Row[] } = {},
) {
  mocks.from.mockReturnValue({
    select: () => ({
      eq: (col: string) => ({ limit: () => Promise.resolve({ data: col === "norm_skeleton" ? skelData : exactData }) }),
      ilike: () => ({ limit: () => Promise.resolve({ data: arabicData }) }),
    }),
  });
  mocks.rpc.mockResolvedValue({ data: suggData });
}

beforeEach(() => vi.clearAllMocks());

describe("normalizeWord", () => {
  it("lowercases, strips diacritics and punctuation, collapses spaces", () => {
    expect(normalizeWord("Aaeen")).toBe("aaeen");
    expect(normalizeWord("Aā-eén!")).toBe("aa een");
    expect(normalizeWord("  Aaeen  si ")).toBe("aaeen si");
  });
});

describe("lookupLisanWord", () => {
  it("returns ok with the exact entry when the normalized word matches", async () => {
    wire({ exactData: [{ transliteration: "Aaeen", lisan: "اْئين", meaning: "Regulation, rules, law", example: "" }] });
    const res = await lookupLisanWord("aaeen");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toContain("Regulation");
    expect(mocks.rpc).not.toHaveBeenCalled(); // no fuzzy fallback needed
  });

  it("returns did_you_mean (NOT the meaning) when there is no exact match", async () => {
    wire({ exactData: [], suggData: [{ transliteration: "Aameen", lisan: "آمين", meaning: "So be it", example: "" }] });
    const res = await lookupLisanWord("aaeen");
    expect(res.status).toBe("did_you_mean");
    expect(res.status === "did_you_mean" && res.suggestions[0].transliteration).toBe("Aameen");
    expect(mocks.rpc).toHaveBeenCalledWith("match_lisan_words", expect.objectContaining({ query_norm: "aaeen" }));
  });

  it("answers directly when exactly one consonant-skeleton match exists", async () => {
    // "sadqe" has no exact norm, but its skeleton "sdq" maps to one entry → answer it.
    wire({ exactData: [], skelData: [{ transliteration: "Sadaqa", lisan: "صدقة", meaning: "Charity", example: "" }] });
    const res = await lookupLisanWord("sadqe");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toBe("Charity");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("offers numbered did_you_mean when several skeleton matches exist", async () => {
    wire({ exactData: [], skelData: [
      { transliteration: "Sidq", lisan: "صدق", meaning: "Truth", example: "" },
      { transliteration: "Sadaqa", lisan: "صدقة", meaning: "Charity", example: "" },
    ] });
    const res = await lookupLisanWord("sadqe");
    expect(res.status).toBe("did_you_mean");
    expect(res.status === "did_you_mean" && res.suggestions.map((s) => s.transliteration)).toEqual(["Sidq", "Sadaqa"]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns not_found when neither exact, skeleton, nor fuzzy matches exist", async () => {
    wire({ exactData: [], skelData: [], suggData: [] });
    expect((await lookupLisanWord("zzzzz")).status).toBe("not_found");
  });

  it("matches Lisan-script input against the lisan column", async () => {
    wire({ arabicData: [{ transliteration: "Aaeen", lisan: "اْئين", meaning: "Regulation", example: "" }] });
    const res = await lookupLisanWord("اْئين");
    expect(res.status).toBe("ok");
  });

  it("returns not_found for empty input", async () => {
    wire();
    expect((await lookupLisanWord("   ")).status).toBe("not_found");
  });
});
