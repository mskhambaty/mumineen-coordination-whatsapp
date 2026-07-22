import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/surveys/forms/[id]/results — per-section 1-5 sentiment, response rate, answer
// breakdowns, and qualitative comments for one form.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const includeTest = new URL(req.url).searchParams.get("includeTest") === "1";
  const supabase = getSupabaseAdmin();

  // A big form can have >1000 answers (recipients × questions), so paginate that read.
  type AnsRow = { recipient_id: string; section_id: string | null; question_id: string | null; area: string | null; answer_text: string | null; reason_text: string | null; sentiment_1_5: number | null };
  const answersAll: AnsRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("survey_answers").select("recipient_id, section_id, question_id, area, answer_text, reason_text, sentiment_1_5").eq("form_id", id).range(from, from + 999);
    if (error) break;
    answersAll.push(...((data ?? []) as AnsRow[]));
    if (!data || data.length < 1000) break;
  }
  const [{ data: form }, { data: recips }, { data: fqs }] = await Promise.all([
    supabase.from("survey_forms").select("id, title, status, event_date").eq("id", id).maybeSingle(),
    supabase.from("survey_recipients").select("id, status, is_test").eq("form_id", id),
    supabase.from("survey_form_questions").select("section_id, question_id, area, snapshot").eq("form_id", id),
  ]);
  const answers = answersAll;
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  // By default exclude is_test recipients (self-test / in-team links). includeTest=1 shows them
  // (a separate "test results" view) so the team can validate against their own submissions.
  const allRecips = (recips ?? []) as { id: string; status: string; is_test: boolean }[];
  const recipients = includeTest ? allRecips : allRecips.filter((r) => !r.is_test);
  const testIds = includeTest ? new Set<string>() : new Set(allRecips.filter((r) => r.is_test).map((r) => r.id));
  const sent = recipients.length;
  const completed = recipients.filter((r) => r.status === "completed").length;

  // Section + question metadata for labels.
  const sectionTitle = new Map<string, string>();
  const questionText = new Map<string, string>();
  for (const fq of (fqs ?? []) as { section_id: string | null; question_id: string | null; snapshot: { text?: string; section_title?: string } }[]) {
    if (fq.section_id && fq.snapshot?.section_title) sectionTitle.set(fq.section_id, fq.snapshot.section_title);
    if (fq.question_id && fq.snapshot?.text) questionText.set(fq.question_id, fq.snapshot.text);
  }

  // Aggregate per section (1-5 sentiment) and per question (answer breakdown + comments).
  const bySection = new Map<string, { title: string; scores: number[] }>();
  const byQuestion = new Map<string, { text: string; counts: Record<string, number>; comments: string[]; scores: number[] }>();
  for (const a of (answers ?? []) as { recipient_id: string; section_id: string | null; question_id: string | null; answer_text: string | null; reason_text: string | null; sentiment_1_5: number | null }[]) {
    if (testIds.has(a.recipient_id)) continue;
    if (a.section_id) {
      const s = bySection.get(a.section_id) ?? { title: sectionTitle.get(a.section_id) ?? "Section", scores: [] };
      if (a.sentiment_1_5 != null) s.scores.push(a.sentiment_1_5);
      bySection.set(a.section_id, s);
    }
    if (a.question_id) {
      const q = byQuestion.get(a.question_id) ?? { text: questionText.get(a.question_id) ?? "Question", counts: {}, comments: [], scores: [] };
      if (a.answer_text) q.counts[a.answer_text] = (q.counts[a.answer_text] ?? 0) + 1;
      if (a.sentiment_1_5 != null) q.scores.push(a.sentiment_1_5);
      if (a.reason_text) q.comments.push(a.reason_text);
      byQuestion.set(a.question_id, q);
    }
  }

  const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null);

  return NextResponse.json({
    form,
    include_test: includeTest,
    test_available: allRecips.some((r) => r.is_test),
    response: { sent, completed, rate: sent ? Number((completed / sent).toFixed(2)) : 0 },
    sections: Array.from(bySection.entries()).map(([section_id, s]) => ({ section_id, title: s.title, sentiment: mean(s.scores), responses: s.scores.length })),
    questions: Array.from(byQuestion.entries()).map(([question_id, q]) => ({ question_id, text: q.text, sentiment: mean(q.scores), breakdown: q.counts, comments: q.comments })),
  });
}
