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
  looksLogistics,
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

describe("looksLogistics (FAQ-derived allow-list)", () => {
  it("fires on clear logistics / accommodation / accessibility / timing questions", () => {
    for (const q of [
      "I would want my husband to sit in the masjid last row as he will be on chair or in sehan, whichever u say, but I will need to sit with for his personal needs",
      "can I bring a wheelchair",
      "where should my husband sit",
      "I want utaro",
      "which hotel has a shuttle",
      "where is parking",
      "what time is registration",
      "do I need to register",
      "is there a host family for accommodation",
      "what is the dress code",
      "where is the nearest bathroom",
      // RSVP / meal — members ask about their niyaz RSVP; never a fatwa.
      "what is my RSVP",
      "can you tell me what did I RSVP for 2nd Moharram",
      "update my RSVP",
      "do I need to RSVP for the meal",
    ]) {
      expect(looksLogistics(q), q).toBe(true);
    }
  });

  it("does NOT fire on bare religious-act / ruling questions", () => {
    for (const q of [
      "is dragon fruit halal",
      "is it wajib to do matam",
      "do I need to fast on Ashura",
      "roza farz che",
      "should women do matam",
    ]) {
      expect(looksLogistics(q), q).toBe(false);
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
    // Permission-shaped ("can I") but not logistics and no fiqh keyword → reaches the classifier.
    const res = await isPersonalRuling("can I bring my own tasbeeh for my family");
    expect(res.ruling).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("classifier error fails closed to not-ruling (fast-path already guards explicit cases)", async () => {
    mocks.create.mockRejectedValue(new Error("model down"));
    const res = await isPersonalRuling("am I supposed to do this thing");
    expect(res.ruling).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("rescues the reported seating message via logistics WITHOUT calling the classifier", async () => {
    const res = await isPersonalRuling(
      "I would want my husband to sit in the masjid last row as he will be on chair or in sehan, whichever u say, but I will need to sit with for his personal needs",
    );
    expect(res).toEqual({ ruling: false, via: "logistics" });
    expect(mocks.create).not.toHaveBeenCalled(); // logistics short-circuit, classifier untouched
  });

  it("logistics rescue runs only AFTER the keyword fast-path (explicit fatwa still refuses)", async () => {
    // Mentions the mawaid (logistics word) but explicitly asks halal — keyword wins, no rescue.
    const res = await isPersonalRuling("is it halal to eat at the mawaid");
    expect(res).toEqual({ ruling: true, via: "keyword" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("an ambiguous non-logistics message still reaches the cautious classifier (unchanged)", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"ruling": true}' } }] });
    const res = await isPersonalRuling("am I supposed to eat dragon fruit during these days");
    expect(res).toEqual({ ruling: true, via: "classifier" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("rescues an RSVP question via logistics WITHOUT calling the classifier", async () => {
    // "do I need to" trips the permission pre-filter; the rsvp logistics term must short-circuit first.
    const res = await isPersonalRuling("do I need to RSVP for the meal");
    expect(res).toEqual({ ruling: false, via: "logistics" });
    expect(mocks.create).not.toHaveBeenCalled();
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
