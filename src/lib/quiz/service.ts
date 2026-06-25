import { gradeAnswers, isValidPick, type SubmittedAnswer } from "@/lib/quiz/grading";
import { QUIZ_KEY, QUIZ_QUESTIONS, QUIZ_TITLE_EN, QUIZ_TITLE_LD } from "@/lib/quiz/questions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generateSurveyToken } from "@/lib/surveys/tokens";

const RECIPIENT_COLS = "id, quiz_key, display_name, token, status, score, total, completed_at";

// Shape a question for the public page: bilingual text + the correctIndex (for instant client-side
// feedback). Grading is still done server-side on submit, so exposing correctIndex only affects the
// low-stakes instant-feedback UX, never the stored score.
function publicQuestions() {
  return QUIZ_QUESTIONS.map((q) => ({
    id: q.id,
    majlis: q.majlis,
    majlis_ld: q.majlisLd,
    correct_index: q.correctIndex,
    en: q.en,
    ld: q.ld, // null until the translation is fed in; the page falls back to English
  }));
}

export type LoadedQuiz =
  | { status: "not_found" }
  | { status: "completed"; first_name: string | null; score: number | null; total: number | null }
  | {
      status: "ok";
      quiz_key: string;
      title_en: string;
      title_ld: string;
      first_name: string | null;
      questions: ReturnType<typeof publicQuestions>;
    };

// Public, token-scoped load. Marks the recipient "opened" on first view (idempotent — never
// overwrites a completion). A completed recipient gets their saved score back instead of the quiz.
export async function loadQuizForToken(token: string): Promise<LoadedQuiz> {
  const supabase = getSupabaseAdmin();
  const { data: rec } = await supabase.from("quiz_recipients").select(RECIPIENT_COLS).eq("token", token).maybeSingle();
  if (!rec) return { status: "not_found" };

  const firstName = (rec.display_name ?? "").trim().split(/\s+/)[0] || null;
  if (rec.status === "completed") {
    return { status: "completed", first_name: firstName, score: rec.score, total: rec.total };
  }
  if (rec.status !== "opened") {
    await supabase
      .from("quiz_recipients")
      .update({ status: "opened", opened_at: new Date().toISOString() })
      .eq("id", rec.id)
      .neq("status", "completed");
  }
  return {
    status: "ok",
    quiz_key: rec.quiz_key,
    title_en: QUIZ_TITLE_EN,
    title_ld: QUIZ_TITLE_LD,
    first_name: firstName,
    questions: publicQuestions(),
  };
}

export type RecordResult =
  | { error: string }
  | { status: "completed"; score: number; total: number; answers: ReturnType<typeof gradeAnswers>["answers"] };

// Grade + persist a submission. Idempotent: a second submit returns the existing score rather than
// re-grading, so a double-tap or refresh can't change the recorded result.
export async function recordQuizResponse(token: string, submitted: SubmittedAnswer[]): Promise<RecordResult> {
  const supabase = getSupabaseAdmin();
  const { data: rec } = await supabase.from("quiz_recipients").select(RECIPIENT_COLS).eq("token", token).maybeSingle();
  if (!rec) return { error: "Invalid quiz link." };
  if (rec.status === "completed") {
    const graded = gradeAnswers(submitted);
    return { status: "completed", score: rec.score ?? 0, total: rec.total ?? graded.total, answers: graded.answers };
  }

  const clean = submitted.filter((a) => isValidPick(a.question_id, a.chosen_index));
  const graded = gradeAnswers(clean);

  const rows = graded.answers.map((a) => ({
    recipient_id: rec.id,
    quiz_key: rec.quiz_key,
    question_id: a.question_id,
    chosen_index: a.chosen_index,
    is_correct: a.is_correct,
  }));
  // Replace any prior partials, then insert the graded set.
  await supabase.from("quiz_answers").delete().eq("recipient_id", rec.id);
  if (rows.length) {
    const { error } = await supabase.from("quiz_answers").insert(rows);
    if (error) return { error: "Could not save your answers. Please try again." };
  }
  await supabase
    .from("quiz_recipients")
    .update({ status: "completed", score: graded.score, total: graded.total, completed_at: new Date().toISOString() })
    .eq("id", rec.id);

  return { status: "completed", score: graded.score, total: graded.total, answers: graded.answers };
}

// Admin-only leaderboard: completed, non-test recipients ranked by score (then earliest finish).
export type LeaderboardRow = { name: string | null; score: number; total: number; completed_at: string | null };
export async function getLeaderboard(quizKey = QUIZ_KEY): Promise<{
  rows: LeaderboardRow[];
  summary: { sent: number; completed: number; avg_score: number | null; total: number };
}> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("quiz_recipients")
    .select("display_name, score, total, status, completed_at, is_test")
    .eq("quiz_key", quizKey)
    .eq("is_test", false);
  const all = (data ?? []) as { display_name: string | null; score: number | null; total: number | null; status: string; completed_at: string | null }[];
  const completed = all.filter((r) => r.status === "completed");
  const rows: LeaderboardRow[] = completed
    .map((r) => ({ name: r.display_name, score: r.score ?? 0, total: r.total ?? QUIZ_QUESTIONS.length, completed_at: r.completed_at }))
    .sort((a, b) => b.score - a.score || (a.completed_at ?? "").localeCompare(b.completed_at ?? ""));
  const avg = completed.length ? Math.round((completed.reduce((s, r) => s + (r.score ?? 0), 0) / completed.length) * 10) / 10 : null;
  return { rows, summary: { sent: all.length, completed: completed.length, avg_score: avg, total: QUIZ_QUESTIONS.length } };
}

// Mint a recipient + token and return the shareable link. Used for test links now and for the
// real WhatsApp broadcast send later (which will reuse the survey template-dispatch mechanism).
export async function createQuizRecipient(input: {
  phone_e164?: string | null;
  mumin_id?: string | null;
  display_name?: string | null;
  is_test?: boolean;
}): Promise<{ token: string; link: string }> {
  const supabase = getSupabaseAdmin();
  const token = generateSurveyToken();
  await supabase.from("quiz_recipients").insert({
    quiz_key: QUIZ_KEY,
    phone_e164: input.phone_e164 ?? null,
    mumin_id: input.mumin_id ?? null,
    display_name: input.display_name ?? null,
    token,
    status: "sampled",
    is_test: input.is_test ?? false,
  });
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return { token, link: `${base}/quiz/${token}` };
}
