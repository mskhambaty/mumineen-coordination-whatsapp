// Pure answer → 1-5 sentiment scoring for survey responses. No DB, fully unit-testable.
// Higher = better. Choice questions are scored by option position (the databank stores options
// best-first), so they need no polarity. Yes/No and scale questions honor `polarity` so a
// negatively-phrased question ("Did you experience AV disruptions?") inverts correctly.

export type ScoredQuestion = {
  type: "choice" | "scale10" | "scale5" | "yesno" | "text";
  options?: Array<{ label: string; score?: number }> | null;
  polarity?: "positive" | "negative" | null;
};

function clamp1to5(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

// Map a 0-based option index within an N-option list (ordered best→worst) to 1..5.
function scoreByPosition(index: number, count: number): number {
  if (count <= 1) return 3;
  return clamp1to5(5 - (index / (count - 1)) * 4);
}

// Returns 1..5, or null when the answer carries no sentiment (free text, blank, "Other",
// or an unrecognized value).
export function answerSentiment(question: ScoredQuestion, answer: string | null | undefined): number | null {
  if (answer == null) return null;
  const a = String(answer).trim();
  if (!a) return null;
  const negative = question.polarity === "negative";

  switch (question.type) {
    case "text":
      return null;

    case "scale10":
    case "scale5": {
      const n = Number.parseInt(a, 10);
      if (Number.isNaN(n)) return null;
      const base = question.type === "scale10" ? clamp1to5(Math.ceil(n / 2)) : clamp1to5(n);
      return negative ? 6 - base : base;
    }

    case "yesno": {
      const yes = /^y(es)?$/i.test(a);
      const no = /^n(o)?$/i.test(a);
      if (!yes && !no) return null;
      const base = yes ? 5 : 1;
      return negative ? 6 - base : base;
    }

    case "choice": {
      if (a.startsWith("Other")) return null;
      const opts = question.options ?? [];
      const idx = opts.findIndex((o) => o.label === a);
      if (idx === -1) return null;
      const explicit = opts[idx].score;
      if (typeof explicit === "number") return clamp1to5(explicit);
      return scoreByPosition(idx, opts.length);
    }

    default:
      return null;
  }
}

// Mean 1-5 sentiment across a set of (question, answer) pairs, ignoring null-scoring answers.
// Returns null when nothing scored. `round` controls whether to round to an integer 1-5.
export function aggregateSentiment(
  pairs: Array<{ question: ScoredQuestion; answer: string | null | undefined }>,
  round = true,
): number | null {
  const scores = pairs
    .map((p) => answerSentiment(p.question, p.answer))
    .filter((s): s is number => s != null);
  if (scores.length === 0) return null;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return round ? clamp1to5(mean) : mean;
}

// Whether an answer is a "negative" answer per the question's negative_values list (drives the
// qualitative "why" box and negative-count tallies). Independent of the numeric score above.
export function isNegativeAnswer(
  answer: string | null | undefined,
  negativeValues: string[] | null | undefined,
): boolean {
  if (answer == null || !negativeValues?.length) return false;
  return negativeValues.includes(String(answer).trim());
}
