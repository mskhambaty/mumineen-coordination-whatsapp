import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@/lib/ai/model", () => ({
  AI_MODEL: "test-model",
  chatParams: () => ({ model: "test-model" }),
  getAIClient: () => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } }),
}));

const DEPTS = [
  { id: "dep-acc", name: "Accommodation", description: "utaro, hotels, rooms" },
  { id: "dep-avr", name: "AVR", description: "audio, video, sound, screens" },
  { id: "dep-flow", name: "Flow Management", description: "crowd, queues, entrances" },
];

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: DEPTS }) }) }),
  }),
}));

import { classifyDepartment, __resetCatalogCacheForTests } from "@/lib/departments/classify";

function reply(content: string) {
  create.mockResolvedValue({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCatalogCacheForTests();
});
afterEach(() => __resetCatalogCacheForTests());

describe("classifyDepartment", () => {
  it("maps the model's chosen index to the department id", async () => {
    reply('{"index": 2}');
    expect(await classifyDepartment("the sound in the masjid is too low")).toBe("dep-avr");
  });

  it("returns null when the model picks 0 (no clear fit)", async () => {
    reply('{"index": 0}');
    expect(await classifyDepartment("ya ali madad")).toBeNull();
  });

  it("returns null for an out-of-range index", async () => {
    reply('{"index": 99}');
    expect(await classifyDepartment("something")).toBeNull();
  });

  it("returns null for empty text without calling the model", async () => {
    expect(await classifyDepartment("   ")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("never throws — returns null if the model errors", async () => {
    create.mockRejectedValue(new Error("boom"));
    expect(await classifyDepartment("AC broken in mawaid")).toBeNull();
  });
});
