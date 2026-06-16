import { describe, expect, it } from "vitest";

import { aggregateSentiment, answerSentiment, isNegativeAnswer } from "@/lib/surveys/sentiment";

const QUAL = { type: "choice" as const, options: [{ label: "Excellent" }, { label: "Good" }, { label: "Fair" }, { label: "Poor" }] };

describe("answerSentiment", () => {
  it("scores QUAL choice by option position (best-first)", () => {
    expect(answerSentiment(QUAL, "Excellent")).toBe(5);
    expect(answerSentiment(QUAL, "Good")).toBe(4);
    expect(answerSentiment(QUAL, "Fair")).toBe(2);
    expect(answerSentiment(QUAL, "Poor")).toBe(1);
  });

  it("returns null for Other / unknown / blank choice answers", () => {
    expect(answerSentiment(QUAL, "Other: foo")).toBeNull();
    expect(answerSentiment(QUAL, "Nonexistent")).toBeNull();
    expect(answerSentiment(QUAL, "")).toBeNull();
    expect(answerSentiment(QUAL, null)).toBeNull();
  });

  it("scales 1-10 to 1-5 and 1-5 directly", () => {
    expect(answerSentiment({ type: "scale10" }, "10")).toBe(5);
    expect(answerSentiment({ type: "scale10" }, "1")).toBe(1);
    expect(answerSentiment({ type: "scale10" }, "5")).toBe(3);
    expect(answerSentiment({ type: "scale5" }, "4")).toBe(4);
  });

  it("scores yes/no and inverts for negative polarity", () => {
    expect(answerSentiment({ type: "yesno" }, "Yes")).toBe(5);
    expect(answerSentiment({ type: "yesno" }, "No")).toBe(1);
    // "Did you experience AV disruptions?" — Yes is bad.
    expect(answerSentiment({ type: "yesno", polarity: "negative" }, "Yes")).toBe(1);
    expect(answerSentiment({ type: "yesno", polarity: "negative" }, "No")).toBe(5);
  });

  it("honors an explicit per-option score", () => {
    const q = { type: "choice" as const, options: [{ label: "A", score: 2 }, { label: "B", score: 5 }] };
    expect(answerSentiment(q, "A")).toBe(2);
    expect(answerSentiment(q, "B")).toBe(5);
  });

  it("never scores free text", () => {
    expect(answerSentiment({ type: "text" }, "anything")).toBeNull();
  });
});

describe("aggregateSentiment", () => {
  it("means the scored answers, ignoring nulls", () => {
    const pairs = [
      { question: QUAL, answer: "Excellent" }, // 5
      { question: QUAL, answer: "Fair" }, // 2
      { question: { type: "text" as const }, answer: "great" }, // null
    ];
    expect(aggregateSentiment(pairs)).toBe(4); // mean(5,2)=3.5 -> round 4
    expect(aggregateSentiment(pairs, false)).toBeCloseTo(3.5, 5);
  });
  it("returns null when nothing scores", () => {
    expect(aggregateSentiment([{ question: { type: "text" }, answer: "x" }])).toBeNull();
  });
});

describe("isNegativeAnswer", () => {
  it("matches against the negative_values list", () => {
    expect(isNegativeAnswer("Poor", ["Fair", "Poor"])).toBe(true);
    expect(isNegativeAnswer("Good", ["Fair", "Poor"])).toBe(false);
    expect(isNegativeAnswer("No", ["No"])).toBe(true);
    expect(isNegativeAnswer("x", null)).toBe(false);
  });
});
