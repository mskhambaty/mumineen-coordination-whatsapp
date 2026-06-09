import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embeddingsCreate: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/ai/model", () => ({
  getAIClient: () => ({ embeddings: { create: mocks.embeddingsCreate } }),
  AI_EMBEDDING_MODEL: "text-embedding-3-small",
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { retrieveReligiousContext } from "@/lib/scraper/retrieve-site-context";
import { indexReligiousTopic, religiousPageUrl } from "@/lib/knowledge/index-content";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.embeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
});

describe("retrieveReligiousContext", () => {
  it("queries the religious match RPC (never the site one) and formats rows", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { page_title: "Reflections — Majlis 1", page_url: "religious://topic/abc", content: "The theme was al-Falak al-Muheet." },
      ],
      error: null,
    });

    const out = await retrieveReligiousContext("what was majlis 1 about");

    // Dual-embed: the query is embedded twice (raw + event-anchored) and the match RPC is
    // run once per embedding — both against the religious store, never the site one. The
    // identical row returned by both runs is deduped before formatting.
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][0]).toBe("match_religious_content");
    expect(mocks.rpc.mock.calls[1][0]).toBe("match_religious_content");
    expect(out).toContain("[Reflections — Majlis 1]");
    expect(out).toContain("al-Falak al-Muheet");
    // Deduped — the row appears exactly once even though both runs returned it.
    expect(out.match(/Reflections — Majlis 1/g)).toHaveLength(1);
  });

  it("returns empty string when the RPC errors (fail-soft)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await retrieveReligiousContext("x")).toBe("");
  });

  it("returns empty string when there are no matches", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await retrieveReligiousContext("x")).toBe("");
  });
});

describe("indexReligiousTopic", () => {
  it("embeds and inserts into religious_content under the topic page_url", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    mocks.embeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    mocks.from.mockImplementation((table: string) => ({
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: (rows: Array<Record<string, unknown>>) => {
        expect(table).toBe("religious_content");
        inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
    }));

    const count = await indexReligiousTopic("abc", "Vaaz Talaqi", "Q: theme?\nA: al-Falak al-Muheet.");

    expect(count).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].page_url).toBe(religiousPageUrl("topic", "abc"));
    expect(inserted[0].source_type).toBe("topic_block");
    expect(inserted[0].page_title).toBe("Vaaz Talaqi");
  });

  it("deletes prior chunks and inserts nothing for empty content", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn();
    mocks.from.mockImplementation(() => ({ delete: () => ({ eq: deleteEq }), insert }));

    const count = await indexReligiousTopic("abc", "Empty", "   ");

    expect(count).toBe(0);
    expect(deleteEq).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("religiousPageUrl", () => {
  it("namespaces topics and docs distinctly", () => {
    expect(religiousPageUrl("topic", "1")).toBe("religious://topic/1");
    expect(religiousPageUrl("doc", "1")).toBe("religious://doc/1");
  });
});
