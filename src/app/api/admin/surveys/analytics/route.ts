import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/surveys/analytics — cross-form feedback analytics, filterable on every attribute
// (which forms/samples, area, section, and the responder's personal attributes age/gender/
// local-mehman/rahat/jamaat/category). All returned aggregates reflect the active filter set.
// POST (not GET) so the rich filter object travels in the body. Read-only — no writes.
const filterSchema = z.object({
  formIds: z.array(z.string().uuid()).optional(),
  areas: z.array(z.string()).optional(),
  sectionIds: z.array(z.string().uuid()).optional(),
  includeTest: z.boolean().optional(),
  gender: z.enum(["M", "F"]).optional(),
  ageMin: z.number().int().min(0).max(120).optional(),
  ageMax: z.number().int().min(0).max(120).optional(),
  localMehman: z.enum(["Local", "Mehman"]).optional(),
  rahatOnly: z.boolean().optional(),
  jamaats: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
});

type MuminAttr = {
  age: number | null;
  gender: string | null;
  local_mehman: string | null;
  rahat: boolean;
  jamaat: string | null;
  category: string | null;
};

const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null);
function ageBucket(age: number | null): string {
  if (age == null) return "Unknown";
  if (age < 13) return "0–12";
  if (age < 20) return "13–19";
  if (age < 35) return "20–34";
  if (age < 50) return "35–49";
  if (age < 65) return "50–64";
  return "65+";
}

export async function POST(req: NextRequest) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;

  const parsed = filterSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters", details: parsed.error.flatten() }, { status: 400 });
  const f = parsed.data;
  const supabase = getSupabaseAdmin();

  // Forms in scope (for the filter dropdown + default = all forms).
  const { data: formsRaw } = await supabase.from("survey_forms").select("id, title, status, group_id, rules").order("created_at", { ascending: false });
  const allForms = (formsRaw ?? []) as { id: string; title: string; status: string }[];
  const scopeFormIds = f.formIds && f.formIds.length ? f.formIds : allForms.map((x) => x.id);

  // Recipients (response-rate denominators + test exclusion) and answers, scoped to those forms.
  const [{ data: recipsRaw }, { data: answersRaw }, { data: sectionsRaw }] = await Promise.all([
    supabase.from("survey_recipients").select("id, form_id, mumin_id, status, is_test").in("form_id", scopeFormIds.length ? scopeFormIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("survey_answers").select("recipient_id, form_id, mumin_id, section_id, question_id, area, answer_text, reason_text, sentiment_1_5").in("form_id", scopeFormIds.length ? scopeFormIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("survey_sections").select("id, title"),
  ]);
  const recips = (recipsRaw ?? []) as { id: string; form_id: string; mumin_id: string | null; status: string; is_test: boolean }[];
  const answers = (answersRaw ?? []) as { recipient_id: string; form_id: string; mumin_id: string | null; section_id: string | null; question_id: string | null; area: string | null; answer_text: string | null; reason_text: string | null; sentiment_1_5: number | null }[];
  const sectionTitle = new Map(((sectionsRaw ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title]));

  // Roster attributes for everyone referenced (for personal filters + attribute breakdowns).
  const muminIds = Array.from(new Set([...recips, ...answers].map((r) => r.mumin_id).filter((x): x is string => Boolean(x))));
  const attr = new Map<string, MuminAttr>();
  for (let i = 0; i < muminIds.length; i += 500) {
    const { data } = await supabase
      .from("mumineen")
      .select("id, age, gender, local_mehman, rahat_seating, wheelchair, jamaat, category")
      .in("id", muminIds.slice(i, i + 500));
    for (const m of (data ?? []) as { id: string; age: number | null; gender: string | null; local_mehman: string | null; rahat_seating: boolean | null; wheelchair: boolean | null; jamaat: string | null; category: string | null }[]) {
      attr.set(m.id, { age: m.age, gender: m.gender, local_mehman: m.local_mehman, rahat: Boolean(m.rahat_seating || m.wheelchair), jamaat: m.jamaat, category: m.category });
    }
  }

  // Personal-attribute predicate applied to a mumin id.
  const passesPersonal = (muminId: string | null): boolean => {
    if (!muminId) return !f.gender && f.ageMin == null && f.ageMax == null && !f.localMehman && !f.rahatOnly && !f.jamaats?.length && !f.categories?.length;
    const a = attr.get(muminId);
    if (!a) return false;
    if (f.gender && a.gender !== f.gender) return false;
    if (f.ageMin != null && (a.age == null || a.age < f.ageMin)) return false;
    if (f.ageMax != null && (a.age == null || a.age > f.ageMax)) return false;
    if (f.localMehman && a.local_mehman !== f.localMehman) return false;
    if (f.rahatOnly && !a.rahat) return false;
    if (f.jamaats?.length && (!a.jamaat || !f.jamaats.includes(a.jamaat))) return false;
    if (f.categories?.length && (!a.category || !f.categories.includes(a.category))) return false;
    return true;
  };

  // Recipients in filter (non-test unless includeTest) → response-rate.
  const testRecipIds = new Set(recips.filter((r) => r.is_test).map((r) => r.id));
  const fRecips = recips.filter((r) => (f.includeTest || !r.is_test) && passesPersonal(r.mumin_id));
  const sentRespondents = new Set(fRecips.map((r) => r.mumin_id));
  const completedRecips = fRecips.filter((r) => r.status === "completed");

  // Answers in filter: area/section + personal + (test exclusion via recipient).
  const fAnswers = answers.filter((a) => {
    if (!f.includeTest && testRecipIds.has(a.recipient_id)) return false;
    if (f.areas?.length && (!a.area || !f.areas.includes(a.area))) return false;
    if (f.sectionIds?.length && (!a.section_id || !f.sectionIds.includes(a.section_id))) return false;
    return passesPersonal(a.mumin_id);
  });

  // ---- Aggregations (all over fAnswers) ----
  const scored = fAnswers.filter((a) => a.sentiment_1_5 != null).map((a) => a.sentiment_1_5 as number);
  const distribution = [1, 2, 3, 4, 5].map((n) => ({ score: n, count: scored.filter((s) => s === n).length }));

  const group = <K extends string>(keyFn: (a: (typeof fAnswers)[number]) => K | null) => {
    const m = new Map<K, number[]>();
    for (const a of fAnswers) {
      if (a.sentiment_1_5 == null) continue;
      const k = keyFn(a);
      if (k == null) continue;
      (m.get(k) ?? m.set(k, []).get(k)!).push(a.sentiment_1_5);
    }
    return m;
  };
  const toRows = <K extends string>(m: Map<K, number[]>) =>
    Array.from(m.entries()).map(([key, xs]) => ({ key, sentiment: mean(xs), responses: xs.length })).sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0));

  const bySection = toRows(group((a) => (a.section_id ? (sectionTitle.get(a.section_id) ?? "Section") : null)));
  const byArea = toRows(group((a) => a.area));
  const byMehman = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.local_mehman ?? null : null)));
  const byGender = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.gender ?? null : null)));
  const byAge = toRows(group((a) => (a.mumin_id ? ageBucket(attr.get(a.mumin_id)?.age ?? null) : null)));
  const byRahat = toRows(group((a) => (a.mumin_id ? (attr.get(a.mumin_id)?.rahat ? "Rahat / accessibility" : "General") : null)));
  const byJamaat = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.jamaat ?? null : null))).slice(0, 20);

  // Per question: sentiment + answer breakdown.
  const qText = new Map<string, string>();
  const qScores = new Map<string, number[]>();
  const qBreakdown = new Map<string, Record<string, number>>();
  for (const a of fAnswers) {
    if (!a.question_id) continue;
    if (a.sentiment_1_5 != null) (qScores.get(a.question_id) ?? qScores.set(a.question_id, []).get(a.question_id)!).push(a.sentiment_1_5);
    if (a.answer_text) {
      const b = qBreakdown.get(a.question_id) ?? {};
      b[a.answer_text] = (b[a.answer_text] ?? 0) + 1;
      qBreakdown.set(a.question_id, b);
    }
  }
  // Question text from form snapshots.
  const { data: fqs } = await supabase.from("survey_form_questions").select("question_id, snapshot").in("form_id", scopeFormIds.length ? scopeFormIds : ["00000000-0000-0000-0000-000000000000"]);
  for (const fq of (fqs ?? []) as { question_id: string | null; snapshot: { text?: string } }[]) if (fq.question_id && fq.snapshot?.text) qText.set(fq.question_id, fq.snapshot.text);
  const byQuestion = Array.from(new Set([...qScores.keys(), ...qBreakdown.keys()])).map((qid) => ({
    question_id: qid,
    text: qText.get(qid) ?? "Question",
    sentiment: mean(qScores.get(qid) ?? []),
    responses: (qScores.get(qid) ?? []).length,
    breakdown: qBreakdown.get(qid) ?? {},
  })).sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0));

  // Free-text + negative-reason comments (text answers and reason boxes), with context.
  const comments = fAnswers
    .filter((a) => (a.reason_text && a.reason_text.trim()) || (a.answer_text && a.answer_text.trim().length > 12 && (a.sentiment_1_5 == null)))
    .map((a) => ({
      text: (a.reason_text || a.answer_text || "").trim(),
      area: a.area,
      section: a.section_id ? sectionTitle.get(a.section_id) ?? null : null,
      question: a.question_id ? qText.get(a.question_id) ?? null : null,
      sentiment: a.sentiment_1_5,
    }))
    .filter((c) => c.text.length > 0);

  // Filter-option universe (so the UI dropdowns only show relevant values).
  const jamaatOpts = Array.from(new Set(Array.from(attr.values()).map((a) => a.jamaat).filter((x): x is string => Boolean(x)))).sort();
  const categoryOpts = Array.from(new Set(Array.from(attr.values()).map((a) => a.category).filter((x): x is string => Boolean(x)))).sort();

  return NextResponse.json({
    forms: allForms.map((x) => ({ id: x.id, title: x.title, status: x.status })),
    options: { jamaats: jamaatOpts, categories: categoryOpts, sections: Array.from(sectionTitle.entries()).map(([id, title]) => ({ id, title })) },
    overview: {
      respondents: sentRespondents.size,
      completed: completedRecips.length,
      response_rate: fRecips.length ? Number((completedRecips.length / fRecips.length).toFixed(2)) : 0,
      answers: fAnswers.length,
      avg_sentiment: mean(scored),
      comment_count: comments.length,
    },
    distribution,
    by_section: bySection,
    by_area: byArea,
    by_question: byQuestion,
    by_attribute: { local_mehman: byMehman, gender: byGender, age: byAge, rahat: byRahat, jamaat: byJamaat },
    comments,
  });
}
