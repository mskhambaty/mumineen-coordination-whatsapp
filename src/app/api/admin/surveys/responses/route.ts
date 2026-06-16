import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/surveys/responses — individual mumin survey-feedback lookup.
//   ?q=<name|its>  → up to 20 candidate matches [{ its, name }] to pick from.
//   ?its=<its>     → that person's full survey history: every answer (with question text, the form
//                    and section it came from, their 1-5 sentiment and any reason), the forms they
//                    were sent, per-section sentiment, and an overall sentiment.
export async function GET(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const supabase = getSupabaseAdmin();
  const url = new URL(req.url);
  const its = url.searchParams.get("its")?.trim();
  const q = url.searchParams.get("q")?.trim();

  // Search mode — find the person to look up.
  if (!its && q) {
    const { data } = await supabase
      .from("mumineen")
      .select("its, full_name")
      .eq("roster_active", true)
      .or(`full_name.ilike.%${q}%,its.ilike.%${q}%`)
      .order("full_name")
      .limit(20);
    return NextResponse.json({ matches: ((data ?? []) as { its: string; full_name: string | null }[]).map((m) => ({ its: m.its, name: m.full_name })) });
  }

  if (!its) return NextResponse.json({ error: "Provide an ITS (its=) or a search term (q=)." }, { status: 400 });

  const { data: mumin } = await supabase
    .from("mumineen")
    .select("id, its, full_name")
    .eq("its", its)
    .eq("roster_active", true)
    .maybeSingle();
  if (!mumin) return NextResponse.json({ error: `ITS ${its} not found in the active roster.` }, { status: 404 });
  const m = mumin as { id: string; its: string; full_name: string | null };

  const [{ data: recips }, { data: answers }] = await Promise.all([
    supabase.from("survey_recipients").select("form_id, status, completed_at, event_date, is_test").eq("mumin_id", m.id),
    supabase.from("survey_answers").select("form_id, section_id, question_id, area, answer_text, reason_text, sentiment_1_5, event_date").eq("mumin_id", m.id),
  ]);
  const recipients = (recips ?? []) as { form_id: string; status: string; completed_at: string | null; event_date: string | null; is_test: boolean }[];
  const answerRows = (answers ?? []) as { form_id: string; section_id: string | null; question_id: string | null; area: string | null; answer_text: string | null; reason_text: string | null; sentiment_1_5: number | null; event_date: string | null }[];

  // Labels: form titles + question/section text snapshots for the forms involved.
  const formIds = Array.from(new Set([...recipients.map((r) => r.form_id), ...answerRows.map((a) => a.form_id)]));
  const formTitle = new Map<string, string>();
  const qText = new Map<string, string>();   // key: form_id|question_id
  const secTitle = new Map<string, string>(); // key: form_id|section_id
  if (formIds.length > 0) {
    const [{ data: forms }, { data: fqs }] = await Promise.all([
      supabase.from("survey_forms").select("id, title").in("id", formIds),
      supabase.from("survey_form_questions").select("form_id, section_id, question_id, snapshot").in("form_id", formIds),
    ]);
    for (const f of (forms ?? []) as { id: string; title: string }[]) formTitle.set(f.id, f.title);
    for (const fq of (fqs ?? []) as { form_id: string; section_id: string | null; question_id: string | null; snapshot: { text?: string; section_title?: string } }[]) {
      if (fq.question_id) qText.set(`${fq.form_id}|${fq.question_id}`, fq.snapshot?.text ?? "Question");
      if (fq.section_id) secTitle.set(`${fq.form_id}|${fq.section_id}`, fq.snapshot?.section_title ?? "Section");
    }
  }

  const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null);

  // Per-section + overall sentiment, and a flat answer list with labels.
  const bySection = new Map<string, number[]>();
  const allScores: number[] = [];
  const detailed = answerRows.map((a) => {
    if (a.sentiment_1_5 != null) {
      allScores.push(a.sentiment_1_5);
      if (a.section_id) bySection.set(a.section_id, [...(bySection.get(a.section_id) ?? []), a.sentiment_1_5]);
    }
    return {
      form_title: formTitle.get(a.form_id) ?? "Survey",
      section_title: a.section_id ? secTitle.get(`${a.form_id}|${a.section_id}`) ?? "Section" : "Section",
      question: a.question_id ? qText.get(`${a.form_id}|${a.question_id}`) ?? "Question" : "Question",
      answer: a.answer_text,
      sentiment: a.sentiment_1_5,
      reason: a.reason_text,
      date: a.event_date,
    };
  });

  return NextResponse.json({
    mumin: { its: m.its, name: m.full_name },
    overall_sentiment: mean(allScores),
    answered: detailed.length,
    forms_received: recipients.map((r) => ({
      title: formTitle.get(r.form_id) ?? "Survey",
      status: r.status,
      completed_at: r.completed_at,
      event_date: r.event_date,
      is_test: r.is_test,
    })),
    sections: Array.from(bySection.entries()).map(([sid, scores]) => {
      // section title is form-scoped; pick any matching label.
      const label = [...secTitle.entries()].find(([k]) => k.endsWith(`|${sid}`))?.[1] ?? "Section";
      return { title: label, sentiment: mean(scores), responses: scores.length };
    }),
    answers: detailed,
  });
}
