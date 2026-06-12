import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import {
  normalizeWord,
  lookupLisanWord,
  splitForms,
  trigramSim,
  isTrivialLookup,
  prepareLisanRow,
  addLisanWord,
  listAllLisanWords,
} from "@/lib/knowledge/lisan-words";

type Row = { transliteration: string | null; lisan: string | null; meaning: string | null; example: string | null; norm?: string | null; similarity?: number };

// Wire the supabase mock:
//   .eq("norm",…) → exactData,  .eq("norm_skeleton",…) → skelData (legacy fallback)
//   .contains("skeleton_forms",…) → skelData,  .contains("lisan_forms",…) → lisanFormData
//   .ilike() → arabicData,  .rpc() → suggData
function wire(
  { exactData = [], skelData = [], lisanFormData = [], arabicData = [], suggData = [] }:
    { exactData?: Row[]; skelData?: Row[]; lisanFormData?: Row[]; arabicData?: Row[]; suggData?: Row[] } = {},
) {
  mocks.from.mockReturnValue({
    select: () => ({
      eq: (col: string) => ({ limit: () => Promise.resolve({ data: col === "norm_skeleton" ? skelData : exactData }) }),
      contains: (col: string) => ({ limit: () => Promise.resolve({ data: col === "lisan_forms" ? lisanFormData : skelData }) }),
      ilike: () => ({ limit: () => Promise.resolve({ data: arabicData }) }),
    }),
  });
  mocks.rpc.mockResolvedValue({ data: suggData });
}

beforeEach(() => vi.clearAllMocks());

describe("splitForms", () => {
  it("splits compound entries into individual forms", () => {
    expect(splitForms("Ne'mat - Ne'am, An'um")).toEqual(["Ne'mat", "Ne'am", "An'um"]);
    expect(splitForms("نعمة - نعم، انعم")).toEqual(["نعمة", "نعم", "انعم"]);
    expect(splitForms("Ne'mat uzmaa")).toEqual(["Ne'mat uzmaa"]); // single multi-word form, not split
    expect(splitForms("")).toEqual([]);
  });
});

describe("normalizeWord", () => {
  it("lowercases, strips diacritics and punctuation, collapses spaces", () => {
    expect(normalizeWord("Aaeen")).toBe("aaeen");
    expect(normalizeWord("Aā-eén!")).toBe("aa een");
    expect(normalizeWord("  Aaeen  si ")).toBe("aaeen si");
  });
});

describe("trigramSim (pg_trgm-compatible)", () => {
  it("scores a near spelling high and an unrelated same-skeleton word low", () => {
    expect(trigramSim("zohra", "zohrah")).toBeCloseTo(0.625, 2); // matches Postgres similarity()
    expect(trigramSim("zohra", "zeher")).toBeLessThan(0.2);
    expect(trigramSim("abc", "abc")).toBe(1);
    expect(trigramSim("x", "")).toBe(0);
  });
});

describe("isTrivialLookup", () => {
  it("flags affirmatives / numbers / punctuation / 1-char as NOT words", () => {
    for (const t of ["Yes", "yes", "ok", "okay", "sure", "haan", "2", "42", "👍", "!", ".", "a"]) {
      expect(isTrivialLookup(t), t).toBe(true);
    }
  });
  it("does not flag real words", () => {
    for (const t of ["shadi", "aab", "zohra", "تخت"]) expect(isTrivialLookup(t), t).toBe(false);
  });
});

describe("lookupLisanWord", () => {
  it("returns not_found for a trivial reply (Yes / 2) — never a word definition", async () => {
    wire({ suggData: [{ transliteration: "Yaas", lisan: "يأس", meaning: "Hopelessness", example: "", similarity: 0.5 }] });
    expect((await lookupLisanWord("Yes")).status).toBe("not_found");
    expect((await lookupLisanWord("2")).status).toBe("not_found");
    expect(mocks.rpc).not.toHaveBeenCalled(); // blocked before any lookup
  });

  it("returns ok with the exact entry when the normalized word matches", async () => {
    wire({ exactData: [{ transliteration: "Aaeen", lisan: "اْئين", meaning: "Regulation, rules, law", example: "" }] });
    const res = await lookupLisanWord("aaeen");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toContain("Regulation");
    expect(mocks.rpc).not.toHaveBeenCalled(); // exact hit, no fuzzy needed
  });

  it("answers the nearest spelling directly (zohra → Zohrah, NOT same-skeleton junk)", async () => {
    // The real bug: skeleton 'zhr' matched Zeher/Izhaar and short-circuited. Trigram-first +
    // floor surfaces Zohrah (0.625) and drops the 0.09 junk.
    wire({ exactData: [], suggData: [
      { transliteration: "Zohrah", lisan: "زهرة", meaning: "Venus", example: "", similarity: 0.625 },
      { transliteration: "Zeher", lisan: "زهر", meaning: "Poison", example: "", similarity: 0.091 },
    ] });
    const res = await lookupLisanWord("zohra");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toBe("Venus");
  });

  it("returns did_you_mean for a moderate (not dominant) trigram match", async () => {
    wire({ exactData: [], suggData: [{ transliteration: "Aameen", lisan: "آمين", meaning: "So be it", example: "", similarity: 0.5 }] });
    const res = await lookupLisanWord("aaeen");
    expect(res.status).toBe("did_you_mean");
    expect(res.status === "did_you_mean" && res.suggestions[0].transliteration).toBe("Aameen");
  });

  it("drops weak look-alikes below the floor → not_found (no misleading list)", async () => {
    wire({ exactData: [], skelData: [], suggData: [
      { transliteration: "Jafaa", lisan: "جفاء", meaning: "Harshness", example: "", similarity: 0.30 },
      { transliteration: "Jafaakaari", lisan: "جفاكاري", meaning: "Reign of terror", example: "", similarity: 0.18 },
    ] });
    expect((await lookupLisanWord("jafakash")).status).toBe("not_found");
  });

  it("skeleton FALLBACK recovers a vowel-dropping variant when trigram finds nothing", async () => {
    // "sadqe" trigram is below the floor; skeleton 'sdq' → Sadaqa (norm-scored ≥ skeleton floor).
    wire({ exactData: [], suggData: [], skelData: [{ transliteration: "Sadaqa", lisan: "صدقة", meaning: "Charity", example: "", norm: "sadaqa" }] });
    const res = await lookupLisanWord("sadqe");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toBe("Charity");
    expect(mocks.rpc).toHaveBeenCalled(); // trigram is tried first now
  });

  it("returns not_found when neither exact, trigram, nor skeleton matches exist", async () => {
    wire({ exactData: [], skelData: [], suggData: [] });
    expect((await lookupLisanWord("zzzzz")).status).toBe("not_found");
  });

  it("matches Lisan-script input against the lisan column", async () => {
    wire({ arabicData: [{ transliteration: "Aaeen", lisan: "اْئين", meaning: "Regulation", example: "" }] });
    const res = await lookupLisanWord("اْئين");
    expect(res.status).toBe("ok");
  });

  it("matches a Lisan-script word that is one form of a compound entry", async () => {
    // "نعمة" is a form of "نعمة - نعم، انعم"; lisan_forms exact match answers directly.
    wire({ lisanFormData: [{ transliteration: "Ne'mat - Ne'am, An'um", lisan: "نعمة - نعم، انعم", meaning: "A blessing, favor, or grace", example: "" }] });
    const res = await lookupLisanWord("نعمة");
    expect(res.status).toBe("ok");
    expect(res.status === "ok" && res.matches[0].meaning).toContain("blessing");
  });

  it("returns not_found for empty input", async () => {
    wire();
    expect((await lookupLisanWord("   ")).status).toBe("not_found");
  });
});

describe("prepareLisanRow", () => {
  it("computes norm / skeleton / forms for a simple word", () => {
    const r = prepareLisanRow({ transliteration: "Sadaqa", lisan: "صدقة", meaning: "Charity", example: "" });
    expect(r).toMatchObject({
      transliteration: "Sadaqa",
      lisan: "صدقة",
      meaning: "Charity",
      example: null,
      norm: "sadaqa",
      norm_skeleton: "sdq",
    });
  });

  it("splits a compound entry into per-form skeleton / lisan arrays", () => {
    const r = prepareLisanRow({ transliteration: "Ne'mat - Ne'am, An'um", lisan: "نعمة - نعم، انعم", meaning: "Blessing", example: null });
    expect(r?.skeleton_forms).toEqual(["nmt", "nm"]); // Ne'mat→nmt, Ne'am/An'um→nm (deduped)
    expect(r?.lisan_forms).toEqual(["نعمة", "نعم", "انعم"]);
  });

  it("returns null when there is no usable word text", () => {
    expect(prepareLisanRow({ transliteration: "  ", lisan: "", meaning: "x", example: "" })).toBeNull();
    expect(prepareLisanRow({ transliteration: "!!!", lisan: "", meaning: "x", example: "" })).toBeNull(); // norm empties out
  });
});

describe("addLisanWord", () => {
  const insert = vi.fn();
  const update = vi.fn();

  // Wire the chain for a single add: select("id").eq("norm").limit() → existing rows;
  // select("id",{head}) → count; insert/update → {error}.
  function wireAdd({ existing = [] as { id: number }[], count = 1 } = {}) {
    insert.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    mocks.from.mockReturnValue({
      select: (_cols: string, opts?: { head?: boolean }) =>
        opts?.head
          ? Promise.resolve({ count })
          : { eq: () => ({ limit: () => Promise.resolve({ data: existing }) }) },
      insert,
      update,
    });
  }

  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
  });

  it("inserts a new word with the computed match columns and returns the new count", async () => {
    wireAdd({ existing: [], count: 42 });
    const res = await addLisanWord({ transliteration: "Aflaak", lisan: "افلاك", meaning: "Celestial spheres", example: "" });
    expect(res).toMatchObject({ status: "added", count: 42 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ transliteration: "Aflaak", norm: "aflaak", norm_skeleton: expect.any(String) }));
    expect(update).not.toHaveBeenCalled();
  });

  it("dedupes on norm: an existing word is UPDATED in place, not inserted twice", async () => {
    wireAdd({ existing: [{ id: 7 }], count: 100 });
    const res = await addLisanWord({ transliteration: "Aflaak", lisan: "افلاك", meaning: "Spheres (revised)", example: "" });
    expect(res).toMatchObject({ status: "updated", count: 100 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an empty / textless word without hitting the DB", async () => {
    wireAdd();
    const res = await addLisanWord({ transliteration: "   ", lisan: "", meaning: "nothing", example: "" });
    expect(res).toEqual({ status: "invalid" });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("listAllLisanWords", () => {
  it("returns the four authored columns, ordered, for export", async () => {
    const rows = [{ transliteration: "Aab", lisan: "آب", meaning: "Water", example: null }];
    mocks.from.mockReturnValue({ select: () => ({ order: () => Promise.resolve({ data: rows }) }) });
    expect(await listAllLisanWords()).toEqual(rows);
  });
});
