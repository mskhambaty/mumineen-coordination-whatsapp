import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock BELOW retrieveContext: the embeddings call and the pgvector RPC. This makes the REAL
// dual-embed merge + year filter run (the runAgent integration test mocked retrieveReligiousContext
// itself, which sits ABOVE the filter). A 1448-targeted query that semantically matches a 1447 row
// through BOTH passes must be dropped by the merged-set year filter.
const rpc = vi.fn();
const embed = vi.fn(async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));

vi.mock("@/lib/ai/model", async (orig) => ({
  ...(await orig()),
  getAIClient: () => ({ embeddings: { create: embed } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import { retrieveReligiousContext } from "@/lib/scraper/retrieve-site-context";

// A 1447 reflection row — what the vector match returns on BOTH embedding passes for a query that
// is semantically about Majlis 3, even when the user asked for "this year" (1448).
const ROW_1447 = {
  page_title: "Reflections — Ashara 1447H, Majlis 3",
  content: "Saturn — discipline and jafaakashi.",
  source_url: "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-3-6/",
  category: "reflection",
  year_hijri: "1447",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Both passes (raw + anchored) return the same 1447 row → merged set = [ROW_1447].
  rpc.mockResolvedValue({ data: [ROW_1447], error: null });
});

describe("retrieveContext year filter (exercises the real dual-embed merge + filter)", () => {
  it("issues two embeddings and two RPC matches (dual-embed)", async () => {
    await retrieveReligiousContext("theme of majlis 3", 5, ["reflection"], "1447");
    expect(embed).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("DROPS a 1447 row for a 1448-targeted query (no relabel leak) → empty context", async () => {
    const out = await retrieveReligiousContext("theme of majlis 3 this year", 5, ["reflection"], "1448");
    expect(out).toBe("");
    expect(out).not.toContain("1447");
  });

  it("KEEPS the 1447 row for a 1447-targeted query", async () => {
    const out = await retrieveReligiousContext("theme of majlis 3", 5, ["reflection"], "1447");
    expect(out).toContain("Ashara 1447H");
    expect(out).toContain("Saturn");
  });

  it("no year cue (allowedYear null) → not year-filtered, returns the indexed row", async () => {
    const out = await retrieveReligiousContext("theme of majlis 3", 5, ["reflection"], null);
    expect(out).toContain("Ashara 1447H");
  });

  it("does not crash on a null year_hijri row when a concrete year is required (excludes it)", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW_1447, year_hijri: null }], error: null });
    const out = await retrieveReligiousContext("guardrail", 5, ["reflection"], "1448");
    expect(out).toBe("");
  });
});
