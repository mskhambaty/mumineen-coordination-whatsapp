import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const inserted: Record<string, unknown>[] = [];

vi.mock("@/lib/ai/model", () => ({
  AI_MODEL_HIGH: "high-model",
  MAX_SUMMARY_TOKENS: 2048,
  SUMMARY_TEMPERATURE: 0.4,
  chatParams: () => ({ model: "high-model" }),
  getAIClient: () => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } }),
}));

const MESSAGES = [
  { phone_e164: "+1111", direction: "inbound", body: "The thaal today was cold and late", created_at: "2026-06-15T18:00:00Z" },
  { phone_e164: "+1111", direction: "outbound", body: "Shukran for letting us know.", created_at: "2026-06-15T18:01:00Z" },
  { phone_e164: "+2222", direction: "inbound", body: "Ya Ali Madad", created_at: "2026-06-15T18:05:00Z" },
];
const DEPTS = [
  { id: "dep-mawaid", name: "Mawaid", description: "food, thaal" },
  { id: "dep-flow", name: "Flow Management", description: "crowd" },
];

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b = {
        select: () => b,
        gte: () => b,
        eq: () => b,
        order: () => b,
        delete: () => b,
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { data: unknown[] }) => unknown) =>
          Promise.resolve({ data: table === "messages" ? MESSAGES : table === "departments" ? DEPTS : [] }).then(resolve),
      };
      return b;
    },
  }),
}));

import { mineConversationsForFeedback } from "@/lib/digest/mine-conversations";
import { __resetCatalogCacheForTests } from "@/lib/departments/classify";

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  __resetCatalogCacheForTests();
});
afterEach(() => __resetCatalogCacheForTests());

describe("mineConversationsForFeedback", () => {
  it("extracts feedback from a batched call and inserts mined, department-tagged rows", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [{ summary: "Thaal served cold and late", sentiment: "negative", department_indices: [1], area: "mawaid" }],
            }),
          },
        },
      ],
    });

    const res = await mineConversationsForFeedback("2026-06-15");

    // Both inbound conversations are sent to the model; it returns feedback for only the real one.
    expect(res.conversations).toBe(2);
    expect(res.feedback).toBe(1);
    // One batched LLM call for all conversations, not one-per-conversation.
    expect(create).toHaveBeenCalledTimes(1);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      source: "mined",
      event_date: "2026-06-15",
      department_ids: ["dep-mawaid"],
      area: "mawaid",
      sentiment: "negative",
      comment_text: "Thaal served cold and late",
      phone_e164: null,
    });
  });

  it("inserts nothing when the model finds no feedback", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '{"items":[]}' } }] });
    const res = await mineConversationsForFeedback("2026-06-15");
    expect(res.feedback).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
