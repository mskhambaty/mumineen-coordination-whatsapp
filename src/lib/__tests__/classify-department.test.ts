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

import { classifyDepartment, classifyDepartments, __resetCatalogCacheForTests } from "@/lib/departments/classify";

function reply(content: string) {
  create.mockResolvedValue({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCatalogCacheForTests();
});
afterEach(() => __resetCatalogCacheForTests());

describe("classifyDepartments", () => {
  it("maps multiple indices to multiple department ids (feedback spanning areas)", async () => {
    reply('{"indices": [2, 3]}');
    expect(await classifyDepartments("the sound was low and parking was chaotic")).toEqual(["dep-avr", "dep-flow"]);
  });

  it("returns a single id for single-area feedback", async () => {
    reply('{"indices": [2]}');
    expect(await classifyDepartments("the sound in the masjid is too low")).toEqual(["dep-avr"]);
  });

  it("returns [] when nothing clearly fits, and drops out-of-range indices", async () => {
    reply('{"indices": []}');
    expect(await classifyDepartments("ya ali madad")).toEqual([]);
    reply('{"indices": [99]}');
    expect(await classifyDepartments("something")).toEqual([]);
  });

  it("returns [] for empty text without calling the model", async () => {
    expect(await classifyDepartments("   ")).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("never throws — returns [] if the model errors", async () => {
    create.mockRejectedValue(new Error("boom"));
    expect(await classifyDepartments("AC broken in mawaid")).toEqual([]);
  });
});

describe("classifyDepartment (single)", () => {
  it("returns the first owning department, or null", async () => {
    reply('{"indices": [3, 1]}');
    expect(await classifyDepartment("crowding at the entrance")).toBe("dep-flow");
    reply('{"indices": []}');
    expect(await classifyDepartment("ya ali madad")).toBeNull();
  });
});
