import { describe, expect, it } from "vitest";

import { gradeAnswers, isValidPick } from "@/lib/quiz/grading";
import { QUIZ_QUESTIONS } from "@/lib/quiz/questions";

describe("quiz question bank", () => {
  it("has 15 well-formed questions with unique ids", () => {
    expect(QUIZ_QUESTIONS).toHaveLength(15);
    const ids = new Set(QUIZ_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(15);
    for (const q of QUIZ_QUESTIONS) {
      expect(q.en.options).toHaveLength(4);
      expect(q.en.question.length).toBeGreaterThan(0);
      expect(q.en.explanation.length).toBeGreaterThan(0);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.en.options.length);
    }
  });

  it("Lisan blocks, when present, mirror the English option count", () => {
    for (const q of QUIZ_QUESTIONS) {
      if (q.ld) expect(q.ld.options).toHaveLength(q.en.options.length);
    }
  });
});

describe("gradeAnswers", () => {
  it("scores correct picks, counts skips/wrong against the full total", () => {
    const submitted = QUIZ_QUESTIONS.map((q, n) => ({
      question_id: q.id,
      chosen_index: n < 10 ? q.correctIndex : (q.correctIndex + 1) % 4, // first 10 right, rest wrong
    }));
    const r = gradeAnswers(submitted);
    expect(r.total).toBe(15);
    expect(r.score).toBe(10);
  });

  it("treats a missing question as incorrect (total is the full bank)", () => {
    const r = gradeAnswers([{ question_id: QUIZ_QUESTIONS[0].id, chosen_index: QUIZ_QUESTIONS[0].correctIndex }]);
    expect(r.score).toBe(1);
    expect(r.total).toBe(15);
  });

  it("does not credit an unknown question id", () => {
    const r = gradeAnswers([{ question_id: "does-not-exist", chosen_index: 0 }]);
    expect(r.score).toBe(0);
  });
});

describe("isValidPick", () => {
  it("accepts in-range and null, rejects unknown ids and out-of-range", () => {
    const id = QUIZ_QUESTIONS[0].id;
    expect(isValidPick(id, 0)).toBe(true);
    expect(isValidPick(id, 3)).toBe(true);
    expect(isValidPick(id, null)).toBe(true);
    expect(isValidPick(id, 4)).toBe(false);
    expect(isValidPick(id, -1)).toBe(false);
    expect(isValidPick("nope", 0)).toBe(false);
  });
});
