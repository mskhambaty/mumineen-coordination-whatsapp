import { describe, expect, it } from "vitest";

import { aggregateSentiment, answerSentiment, isNegativeAnswer, isNotApplicable, isProblemAnswer } from "@/lib/surveys/sentiment";

const QUAL = { type: "choice" as const, options: [{ label: "Excellent" }, { label: "Good" }, { label: "Fair" }, { label: "Poor" }] };

describe("answerSentiment", () => {
  it("scores QUAL choice by option position (best-first)", () => {
    expect(answerSentiment(QUAL, "Excellent")).toBe(5);
    expect(answerSentiment(QUAL, "Good")).toBe(4);
    expect(answerSentiment(QUAL, "Fair")).toBe(2);
    expect(answerSentiment(QUAL, "Poor")).toBe(1);
  });

  it("returns null for an informational (scored=false) question, even with option scores", () => {
    // "Where were you sitting during waaz?" — a location/cross-tab dimension, not a rating. Its
    // options carry scores (to rank seat quality) but the answer must NOT count as sentiment.
    const SEATING = {
      type: "choice" as const,
      scored: false,
      options: [{ label: "Main Mardo Masjid", score: 5 }, { label: "Madrasa (Atfaal)", score: 1 }],
    };
    expect(answerSentiment(SEATING, "Madrasa (Atfaal)")).toBeNull();
    expect(answerSentiment(SEATING, "Main Mardo Masjid")).toBeNull();
  });

  it("multichoice (multi-select) carries no sentiment — informational", () => {
    const MC = { type: "multichoice" as const, options: [{ label: "Vision Screening" }, { label: "Dental Screening" }] };
    expect(answerSentiment(MC, "Vision Screening | Dental Screening")).toBeNull();
    expect(answerSentiment(MC, "Vision Screening")).toBeNull();
  });

  it("returns null for Other / unknown / blank choice answers", () => {
    expect(answerSentiment(QUAL, "Other: foo")).toBeNull();
    expect(answerSentiment(QUAL, "Nonexistent")).toBeNull();
    expect(answerSentiment(QUAL, "")).toBeNull();
    expect(answerSentiment(QUAL, null)).toBeNull();
  });

  it("excludes 'not applicable' answers from sentiment (never negative)", () => {
    // A wheelchair-need question scored 1 for "Do not apply" used to drag the average down.
    const Q = { type: "choice" as const, options: [{ label: "Yes", score: 5 }, { label: "Do not apply", score: 1 }] };
    expect(answerSentiment(Q, "Do not apply")).toBeNull();
    expect(answerSentiment(Q, "N/A")).toBeNull();
    expect(answerSentiment(Q, "Not applicable")).toBeNull();
    expect(answerSentiment(Q, "Yes")).toBe(5);
    // Aggregate of [Yes, Do not apply, Do not apply] should be a clean 5, not dragged down.
    expect(aggregateSentiment([{ question: Q, answer: "Yes" }, { question: Q, answer: "Do not apply" }, { question: Q, answer: "Do not apply" }])).toBe(5);
    // Yes/No N/A too.
    expect(answerSentiment({ type: "yesno" }, "Does not apply")).toBeNull();
    expect(isNotApplicable("do not apply")).toBe(true);
    expect(isNotApplicable("Yes")).toBe(false);
    // N/A never opens the comment box / routes to a department.
    expect(isProblemAnswer("choice", "Do not apply", ["Do not apply"])).toBe(false);
  });

  it("honors per-question comment threshold and enablement", () => {
    // Default scale10 threshold is 6.
    expect(isProblemAnswer("scale10", "6", null)).toBe(true);
    expect(isProblemAnswer("scale10", "7", null)).toBe(false);
    // Custom threshold: only ≤ 3 is a problem.
    expect(isProblemAnswer("scale10", "4", null, { threshold: 3 })).toBe(false);
    expect(isProblemAnswer("scale10", "3", null, { threshold: 3 })).toBe(true);
    // scale5 custom threshold.
    expect(isProblemAnswer("scale5", "2", null, { threshold: 2 })).toBe(true);
    expect(isProblemAnswer("scale5", "3", null, { threshold: 2 })).toBe(false);
    // Disabled: never a problem, even a clearly-negative answer.
    expect(isProblemAnswer("scale5", "1", null, { collectComment: false })).toBe(false);
    expect(isProblemAnswer("choice", "Poor", ["Poor"], { collectComment: false })).toBe(false);
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
