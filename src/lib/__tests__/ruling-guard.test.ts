import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/ai/model", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getAIClient: () => ({ chat: { completions: { create: mocks.create } } }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: mocks.insert }) }),
}));

import {
  isPersonalRuling,
  rulingKeywordHit,
  flagRulingQuestion,
  RULING_REFUSAL_REPLY,
} from "@/lib/agent/ruling-guard";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("rulingKeywordHit (deterministic fast-path)", () => {
  it("fires on explicit ruling questions", () => {
    for (const q of [
      "Is dragon fruit halal?",
      "is it wajib to do matam?",
      "do i need to fast on aashura?",
      "should I keep roza on 9th too?",
      "is it haram to listen to music",
      "roza farz che ke nai",
      "namaz farz che",
      "is it permissible for me to travel",
      "should women do matam",
    ]) {
      expect(rulingKeywordHit(q), q).toBe(true);
    }
  });

  it("does NOT fire on Waaz-content / logistics / word questions", () => {
    for (const q of [
      "what did Maula say about fasting in Majlis 5",
      "is matam mentioned in Majlis 3",
      "which hotel has a shuttle",
      "what does sajda mean",
      "what was the theme of Majlis 4",
      "can I attend the waaz tomorrow",
      "tell me about Ashura",
    ]) {
      expect(rulingKeywordHit(q), q).toBe(false);
    }
  });
});

describe("isPersonalRuling", () => {
  it("keyword hit short-circuits without calling the model", async () => {
    const res = await isPersonalRuling("Is dragon fruit halal?");
    expect(res).toEqual({ ruling: true, via: "keyword" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("falls back to the classifier for paraphrase the regex misses", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"ruling": true}' } }] });
    const res = await isPersonalRuling("am I supposed to eat dragon fruit during these days");
    expect(res).toEqual({ ruling: true, via: "classifier" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not spend an LLM call on non-permission-shaped messages", async () => {
    const res = await isPersonalRuling("what time does the waaz start");
    expect(res.ruling).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("classifier says not-a-ruling → passes through", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"ruling": false}' } }] });
    const res = await isPersonalRuling("can I book the early shuttle for tomorrow");
    expect(res.ruling).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("classifier error fails closed to not-ruling (fast-path already guards explicit cases)", async () => {
    mocks.create.mockRejectedValue(new Error("model down"));
    const res = await isPersonalRuling("am I supposed to do this thing");
    expect(res.ruling).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("flagRulingQuestion", () => {
  it("inserts a flag row with the truncated message", async () => {
    await flagRulingQuestion("+15551234567", "Is dragon fruit halal?", "keyword");
    expect(mocks.insert).toHaveBeenCalledWith({
      phone_e164: "+15551234567",
      message: "Is dragon fruit halal?",
      detected_by: "keyword",
    });
  });

  it("never throws when the insert fails", async () => {
    mocks.insert.mockRejectedValue(new Error("db down"));
    await expect(flagRulingQuestion("+1555", "x", "classifier")).resolves.toBeUndefined();
  });
});

describe("RULING_REFUSAL_REPLY", () => {
  it("is a polite refusal that redirects to the Aamil Saheb and gives no ruling", () => {
    expect(RULING_REFUSAL_REPLY).toContain("Aamil Saheb");
    expect(RULING_REFUSAL_REPLY.toLowerCase()).toContain("personal ruling");
    expect(RULING_REFUSAL_REPLY.toLowerCase()).toContain("not able to answer");
  });
});
