import { QUIZ_QUESTIONS, getQuestion } from "@/lib/quiz/questions";

export type SubmittedAnswer = { question_id: string; chosen_index: number | null };
export type GradedAnswer = { question_id: string; chosen_index: number | null; correct_index: number; is_correct: boolean };
export type GradeResult = { score: number; total: number; answers: GradedAnswer[] };

// Pure, DB-free grading: score each submitted answer against the question's correctIndex. Unknown
// question ids and out-of-range / null picks are graded as incorrect (never throw). `total` is the
// full question count, so skipping a question counts against the score — not just answered ones.
export function gradeAnswers(submitted: SubmittedAnswer[]): GradeResult {
  const byId = new Map(submitted.map((a) => [a.question_id, a.chosen_index]));
  const answers: GradedAnswer[] = QUIZ_QUESTIONS.map((q) => {
    const chosen = byId.has(q.id) ? byId.get(q.id) ?? null : null;
    const is_correct = chosen !== null && chosen === q.correctIndex;
    return { question_id: q.id, chosen_index: chosen, correct_index: q.correctIndex, is_correct };
  });
  return { score: answers.filter((a) => a.is_correct).length, total: QUIZ_QUESTIONS.length, answers };
}

// Validate a submitted pick references a real question and an in-range option (0..3).
export function isValidPick(question_id: string, chosen_index: number | null): boolean {
  const q = getQuestion(question_id);
  if (!q) return false;
  return chosen_index === null || (Number.isInteger(chosen_index) && chosen_index >= 0 && chosen_index < q.en.options.length);
}
