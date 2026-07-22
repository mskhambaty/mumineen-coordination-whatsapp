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
      requires_identity?: boolean; // shared-link load: taker must enter ITS + name before playing
    };

// Public load by URL segment. Handles BOTH paths:
//  1. a per-recipient token (admin test links) → person-scoped, greets by name, locks on completion.
//  2. the quiz's shared `share_token` → self-identify mode (no person; the page collects ITS + name).
export async function loadQuizForToken(token: string): Promise<LoadedQuiz> {
  const supabase = getSupabaseAdmin();
  const { data: rec } = await supabase.from("quiz_recipients").select(RECIPIENT_COLS).eq("token", token).maybeSingle();
  if (rec) {
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

  // Shared link: the segment is the quiz's share_token. The quiz must be open.
  const { data: quiz } = await supabase.from("quizzes").select("quiz_key, is_open").eq("share_token", token).maybeSingle();
  if (quiz && quiz.is_open) {
    return {
      status: "ok",
      quiz_key: quiz.quiz_key,
      title_en: QUIZ_TITLE_EN,
      title_ld: QUIZ_TITLE_LD,
      first_name: null,
      questions: publicQuestions(),
      requires_identity: true,
    };
  }
  return { status: "not_found" };
}

export type RecordResult =
  | { error: string }
  | { status: "completed"; score: number; total: number; answers: ReturnType<typeof gradeAnswers>["answers"] };

// Grade + persist a per-recipient (test-link) submission. Idempotent: a second submit returns the
// existing score rather than re-grading, so a double-tap or refresh can't change the recorded result.
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

export type SelfIdInput = {
  share_token: string;
  its_number: string;
  name: string;
  duration_seconds: number;
  time_taken_seconds: number;
  answers: SubmittedAnswer[];
};

// Shared-link submission: the taker self-identified with ITS + name. One attempt per (quiz, ITS) —
// a returning ITS gets its saved score back (no retake). Best-effort links the attempt to a roster
// mumin by ITS (admin-only; never returned to the client). NOTE: ITS is PII — never log it.
export async function recordSelfIdentified(input: SelfIdInput): Promise<RecordResult> {
  const supabase = getSupabaseAdmin();

  const { data: quiz } = await supabase.from("quizzes").select("quiz_key, is_open").eq("share_token", input.share_token).maybeSingle();
  if (!quiz || !quiz.is_open) return { error: "This quiz is not available." };
  const quizKey = quiz.quiz_key as string;

  const graded = gradeAnswers(input.answers.filter((a) => isValidPick(a.question_id, a.chosen_index)));

  // Already completed under this ITS → return the saved score, don't re-grade or overwrite.
  const { data: existing } = await supabase
    .from("quiz_recipients")
    .select("id, status, score, total")
    .eq("quiz_key", quizKey)
    .eq("its_number", input.its_number)
    .maybeSingle();
  if (existing && existing.status === "completed") {
    return { status: "completed", score: existing.score ?? 0, total: existing.total ?? graded.total, answers: graded.answers };
  }

  // Best-effort roster linkage by ITS (for the admin leaderboard only).
  const { data: mumin } = await supabase.from("mumineen").select("id, family_id").eq("its", input.its_number).maybeSingle();

  const fields = {
    display_name: input.name,
    mumin_id: mumin?.id ?? null,
    family_id: mumin?.family_id ?? null,
    status: "completed",
    score: graded.score,
    total: graded.total,
    duration_seconds: input.duration_seconds,
    time_taken_seconds: input.time_taken_seconds,
    completed_at: new Date().toISOString(),
  };

  let recipientId = existing?.id as string | undefined;
  if (recipientId) {
    await supabase.from("quiz_recipients").update(fields).eq("id", recipientId);
  } else {
    const { data: ins, error } = await supabase
      .from("quiz_recipients")
      .insert({ quiz_key: quizKey, its_number: input.its_number, is_test: false, opened_at: new Date().toISOString(), ...fields })
      .select("id")
      .single();
    if (error || !ins) {
      // Lost a race on the (quiz_key, its_number) unique index → fetch the winner's score.
      const { data: raced } = await supabase
        .from("quiz_recipients")
        .select("score, total")
        .eq("quiz_key", quizKey)
        .eq("its_number", input.its_number)
        .maybeSingle();
      if (raced) return { status: "completed", score: raced.score ?? graded.score, total: raced.total ?? graded.total, answers: graded.answers };
      return { error: "Could not save your answers. Please try again." };
    }
    recipientId = ins.id as string;
  }

  await supabase.from("quiz_answers").delete().eq("recipient_id", recipientId);
  const rows = graded.answers.map((a) => ({ recipient_id: recipientId, quiz_key: quizKey, question_id: a.question_id, chosen_index: a.chosen_index, is_correct: a.is_correct }));
  if (rows.length) {
    const { error } = await supabase.from("quiz_answers").insert(rows);
    if (error) return { error: "Could not save your answers. Please try again." };
  }
  return { status: "completed", score: graded.score, total: graded.total, answers: graded.answers };
}

// Admin-only leaderboard: completed, non-test attempts ranked by score, then fastest finish, then
// earliest completion. ITS is included for admin display only (never exposed to participants).
export type LeaderboardRow = {
  name: string | null;
  its_number: string | null;
  score: number;
  total: number;
  time_taken_seconds: number | null;
  completed_at: string | null;
};
export async function getLeaderboard(quizKey = QUIZ_KEY): Promise<{
  rows: LeaderboardRow[];
  summary: { sent: number; completed: number; avg_score: number | null; total: number };
}> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("quiz_recipients")
    .select("display_name, its_number, score, total, status, completed_at, time_taken_seconds, is_test")
    .eq("quiz_key", quizKey)
    .eq("is_test", false);
  const all = (data ?? []) as {
    display_name: string | null;
    its_number: string | null;
    score: number | null;
    total: number | null;
    status: string;
    completed_at: string | null;
    time_taken_seconds: number | null;
  }[];
  const completed = all.filter((r) => r.status === "completed");
  const rows: LeaderboardRow[] = completed
    .map((r) => ({
      name: r.display_name,
      its_number: r.its_number,
      score: r.score ?? 0,
      total: r.total ?? QUIZ_QUESTIONS.length,
      time_taken_seconds: r.time_taken_seconds,
      completed_at: r.completed_at,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.time_taken_seconds ?? Infinity) - (b.time_taken_seconds ?? Infinity) ||
        (a.completed_at ?? "").localeCompare(b.completed_at ?? ""),
    );
  const avg = completed.length ? Math.round((completed.reduce((s, r) => s + (r.score ?? 0), 0) / completed.length) * 10) / 10 : null;
  return { rows, summary: { sent: all.length, completed: completed.length, avg_score: avg, total: QUIZ_QUESTIONS.length } };
}

// The shared public link + open state for the admin dashboard.
export async function getQuizShare(quizKey = QUIZ_KEY): Promise<{ share_token: string; is_open: boolean; link: string } | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("quizzes").select("share_token, is_open").eq("quiz_key", quizKey).maybeSingle();
  if (!data) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return { share_token: data.share_token, is_open: data.is_open, link: `${base}/quiz/${data.share_token}` };
}

// Open or close the quiz (closing stops new attempts; the shared link then 404s).
export async function setQuizOpen(isOpen: boolean, quizKey = QUIZ_KEY): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("quizzes").update({ is_open: isOpen }).eq("quiz_key", quizKey);
}

// Mint a recipient + token and return the shareable link. Used for admin TEST links (a per-recipient
// token that bypasses ITS entry so the team can preview the live quiz end-to-end).
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
