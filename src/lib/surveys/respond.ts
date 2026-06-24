import { getSupabaseAdmin } from "@/lib/supabase/server";
import { answerSentiment, isProblemAnswer, type ScoredQuestion } from "@/lib/surveys/sentiment";
import { normalizeArea, resolveDepartmentIdForArea, type FeedbackArea } from "@/lib/feedback/areas";

// Token-scoped survey collection: load the form a recipient's token points to, and record their
// answers (scored 1-5, routed to the area's department, idempotent). No portal/ITS auth — the
// opaque token IS the identity (we show the responder their first name to confirm before submit).

export type QuestionSnapshot = {
  text: string;
  type: ScoredQuestion["type"];
  options?: Array<{ label: string; score?: number }> | null;
  negative_values?: string[] | null;
  polarity?: "positive" | "negative" | null;
  comment_threshold?: number | null;
  collect_comment?: boolean;
  required?: boolean;
  scored?: boolean;
  // Conditional display (public form only): show this question when answer to `qid` equals `equals`.
  show_if?: { qid: string; equals: string } | null;
  section_title?: string | null;
};

export type FormQuestion = {
  form_question_id: string;
  section_id: string | null;
  question_id: string | null;
  area: string | null;
  snapshot: QuestionSnapshot;
};

export type LoadedForm = {
  status: "ok" | "not_found" | "closed" | "completed";
  recipientId?: string;
  firstName?: string | null;
  formTitle?: string;
  alreadyCompleted?: boolean;
  sections?: Array<{ section_id: string | null; title: string; questions: FormQuestion[] }>;
};

export async function loadFormForToken(token: string): Promise<LoadedForm> {
  const supabase = getSupabaseAdmin();
  const { data: recipient } = await supabase
    .from("survey_recipients")
    .select("id, form_id, mumin_id, status, completed_at")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) return { status: "not_found" };

  const r = recipient as { id: string; form_id: string; mumin_id: string | null; status: string; completed_at: string | null };

  const { data: form } = await supabase.from("survey_forms").select("public_title, status").eq("id", r.form_id).maybeSingle();
  if (form && (form as { status: string }).status === "closed") return { status: "closed" };
  // Recipient-facing header: the admin-set public_title only — never the internal label.
  const publicTitle = (form as { public_title: string | null } | null)?.public_title ?? null;

  // One-time submission: a completed token is locked (no re-open / re-edit).
  if (r.completed_at) {
    let firstName: string | null = null;
    if (r.mumin_id) {
      const { data: mm } = await supabase.from("mumineen").select("full_name").eq("id", r.mumin_id).maybeSingle();
      firstName = (mm as { full_name: string | null } | null)?.full_name?.trim() ?? null;
    }
    return { status: "completed", firstName, formTitle: publicTitle ?? undefined };
  }

  const { data: fqs } = await supabase
    .from("survey_form_questions")
    .select("id, section_id, question_id, area, snapshot, sort_order")
    .eq("form_id", r.form_id)
    .order("sort_order");

  // Group questions into their sections, preserving sort order.
  const sections: NonNullable<LoadedForm["sections"]> = [];
  const idx = new Map<string, number>();
  for (const row of (fqs ?? []) as Array<{ id: string; section_id: string | null; question_id: string | null; area: string | null; snapshot: QuestionSnapshot }>) {
    const key = row.section_id ?? "__none__";
    let at = idx.get(key);
    if (at == null) {
      at = sections.length;
      idx.set(key, at);
      sections.push({ section_id: row.section_id, title: row.snapshot?.section_title ?? "Feedback", questions: [] });
    }
    sections[at].questions.push({
      form_question_id: row.id,
      section_id: row.section_id,
      question_id: row.question_id,
      area: row.area,
      snapshot: row.snapshot,
    });
  }

  let firstName: string | null = null;
  if (r.mumin_id) {
    const { data: mumin } = await supabase.from("mumineen").select("full_name").eq("id", r.mumin_id).maybeSingle();
    firstName = (mumin as { full_name: string | null } | null)?.full_name?.trim() ?? null;
  }

  // Mark opened (best-effort, don't overwrite a completion).
  if (r.status === "sampled" || r.status === "sent") {
    await supabase.from("survey_recipients").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", r.id).is("opened_at", null);
  }

  return {
    status: "ok",
    recipientId: r.id,
    firstName,
    formTitle: publicTitle ?? undefined,
    alreadyCompleted: Boolean(r.completed_at),
    sections,
  };
}

export type SubmittedAnswer = { question_id: string; value: string | null; reason?: string | null };

// Record (or replace) a recipient's answers. Idempotent: re-submitting clears prior answers for
// this recipient and re-inserts. Returns the number of answers stored.
export async function recordSurveyResponse(token: string, answers: SubmittedAnswer[]): Promise<{ recorded: number } | { error: string }> {
  const supabase = getSupabaseAdmin();
  const { data: recipient } = await supabase
    .from("survey_recipients")
    .select("id, form_id, mumin_id, family_id, event_date, completed_at")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) return { error: "Invalid or expired survey link." };
  const r = recipient as { id: string; form_id: string; mumin_id: string | null; family_id: string | null; event_date: string | null; completed_at: string | null };
  // One-time submission: once completed, the response is locked.
  if (r.completed_at) return { error: "This survey has already been submitted." };

  // Question metadata for this form (snapshot drives scoring; section_id/area drive routing).
  const { data: fqs } = await supabase
    .from("survey_form_questions")
    .select("question_id, section_id, area, snapshot")
    .eq("form_id", r.form_id);
  const meta = new Map<string, { section_id: string | null; area: string | null; snapshot: QuestionSnapshot }>();
  for (const row of (fqs ?? []) as Array<{ question_id: string | null; section_id: string | null; area: string | null; snapshot: QuestionSnapshot }>) {
    if (row.question_id) meta.set(row.question_id, { section_id: row.section_id, area: row.area, snapshot: row.snapshot });
  }

  // Enforce mandatory questions: every snapshot.required question must have a non-empty answer.
  const answered = new Set(answers.filter((a) => a.value != null && String(a.value).trim() !== "").map((a) => a.question_id));
  const missingRequired: string[] = [];
  for (const [qid, m] of meta) if (m.snapshot.required && !answered.has(qid)) missingRequired.push(qid);
  if (missingRequired.length > 0) {
    return { error: `Please answer all required questions (${missingRequired.length} remaining).` };
  }

  // Resolve area → department id once per distinct area (general → none).
  const deptCache = new Map<string, string | null>();
  async function deptFor(area: FeedbackArea): Promise<string[]> {
    if (!deptCache.has(area)) deptCache.set(area, await resolveDepartmentIdForArea(area));
    const id = deptCache.get(area) ?? null;
    return id ? [id] : [];
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const a of answers) {
    const m = meta.get(a.question_id);
    if (!m) continue; // ignore answers to questions not on this form
    const value = a.value == null ? null : String(a.value);
    if (value == null || value === "") continue; // skip unanswered
    const area = normalizeArea(m.area ?? "general");
    const sentiment = answerSentiment(m.snapshot, value);
    const numeric = m.snapshot.type === "scale10" || m.snapshot.type === "scale5" ? Number.parseInt(value, 10) : null;
    const negative = isProblemAnswer(m.snapshot.type, value, m.snapshot.negative_values, { threshold: m.snapshot.comment_threshold, collectComment: m.snapshot.collect_comment });
    rows.push({
      recipient_id: r.id,
      form_id: r.form_id,
      mumin_id: r.mumin_id,
      family_id: r.family_id,
      section_id: m.section_id,
      question_id: a.question_id,
      area,
      answer_text: value,
      answer_numeric: Number.isNaN(numeric as number) ? null : numeric,
      reason_text: a.reason?.trim() || null,
      sentiment_1_5: sentiment,
      department_ids: negative || sentiment != null ? await deptFor(area) : [],
      event_date: r.event_date,
    });
  }

  // Idempotent replace.
  await supabase.from("survey_answers").delete().eq("recipient_id", r.id);
  if (rows.length > 0) {
    const { error } = await supabase.from("survey_answers").insert(rows);
    if (error) return { error: error.message };
  }
  await supabase
    .from("survey_recipients")
    .update({ status: "completed", completed_at: new Date().toISOString(), opened_at: new Date().toISOString() })
    .eq("id", r.id);

  return { recorded: rows.length };
}
