import { describe, expect, it } from "vitest";

import { chatParams, isReasoningModel } from "@/lib/ai/model";

describe("isReasoningModel", () => {
  it("flags GPT-5.x and o-series models", () => {
    for (const m of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5", "o1", "o3-mini", "o4"]) {
      expect(isReasoningModel(m)).toBe(true);
    }
  });

  it("does not flag gpt-4o-family / older models", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]) {
      expect(isReasoningModel(m)).toBe(false);
    }
  });
});

describe("chatParams", () => {
  // Regression: GPT-5.x models 400 on `max_tokens` and on a custom `temperature`. The final
  // religious-answer completion sent both, so every Waaz Talaqi reply threw → silent outage.
  // They also default to heavy reasoning that eats the token budget / blows the timeout, so we
  // pin `reasoning_effort: "low"` for visible, fast answers.
  it("omits temperature, uses max_completion_tokens, and pins low reasoning for reasoning models", () => {
    const params = chatParams("gpt-5.4", { maxTokens: 1024, temperature: 0.2 });
    expect(params).toEqual({
      model: "gpt-5.4",
      max_completion_tokens: 1024,
      reasoning_effort: "low",
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("max_tokens");
  });

  it("keeps temperature and sends no reasoning_effort for non-reasoning models", () => {
    const params = chatParams("gpt-4o-mini", { maxTokens: 500, temperature: 0.1 });
    expect(params).toEqual({ model: "gpt-4o-mini", max_completion_tokens: 500, temperature: 0.1 });
    expect(params).not.toHaveProperty("max_tokens");
    expect(params).not.toHaveProperty("reasoning_effort");
  });

  it("omits temperature when none is requested", () => {
    expect(chatParams("gpt-4o-mini", { maxTokens: 256 })).toEqual({
      model: "gpt-4o-mini",
      max_completion_tokens: 256,
    });
  });
});
