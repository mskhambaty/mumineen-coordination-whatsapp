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
  // Inclusive send-date range (answer.event_date, YYYY-MM-DD) to scope to specific day(s).
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Drill-down: when set, also return the individual responses whose sentiment equals this score
  // (who answered what), so the distribution bars can open a "who responded" side pane.
  drillScore: z.number().int().min(1).max(5).optional(),
});

type MuminAttr = {
  name: string | null;
  its: string | null;
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
  const { data: formsRaw } = await supabase.from("survey_forms").select("id, title, status, tags, event_date, sent_at, group_id, rules").order("created_at", { ascending: false });
  const allForms = (formsRaw ?? []) as { id: string; title: string; status: string; tags: string[] | null; event_date: string | null; sent_at: string | null }[];
  const scopeFormIds = f.formIds && f.formIds.length ? f.formIds : allForms.map((x) => x.id);

  // Recipients (response-rate denominators + test exclusion) and answers, scoped to those forms.
  // Both paginate — a single PostgREST read caps at 1000 rows, which would silently truncate every
  // analytics aggregate once answers/recipients exceed 1000.
  const scopeIds = scopeFormIds.length ? scopeFormIds : ["00000000-0000-0000-0000-000000000000"];
  type Recip = { id: string; form_id: string; mumin_id: string | null; status: string; is_test: boolean };
  type Answer = { recipient_id: string; form_id: string; mumin_id: string | null; section_id: string | null; question_id: string | null; area: string | null; answer_text: string | null; reason_text: string | null; sentiment_1_5: number | null; event_date: string | null; created_at: string | null };
  const recips: Recip[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("survey_recipients").select("id, form_id, mumin_id, status, is_test").in("form_id", scopeIds).range(from, from + 999);
    if (error) break;
    recips.push(...((data ?? []) as Recip[]));
    if (!data || data.length < 1000) break;
  }
  const rawAnswers: Answer[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("survey_answers").select("recipient_id, form_id, mumin_id, section_id, question_id, area, answer_text, reason_text, sentiment_1_5, event_date, created_at").in("form_id", scopeIds).range(from, from + 999);
    if (error) break;
    rawAnswers.push(...((data ?? []) as Answer[]));
    if (!data || data.length < 1000) break;
  }
  // Dedupe to ONE answer per (mumin, question), keeping the latest — so duplicate sends (and shared
  // sections like Overall/Seating that ride every form) can't inflate any count. Rows missing
  // mumin_id or question_id can't be deduped, so they pass through as-is.
  const latestByPair = new Map<string, Answer>();
  const answers: Answer[] = [];
  for (const a of rawAnswers) {
    if (!a.mumin_id || !a.question_id) { answers.push(a); continue; }
    const k = `${a.mumin_id}:${a.question_id}`;
    const prev = latestByPair.get(k);
    if (!prev || (a.created_at ?? "") > (prev.created_at ?? "")) latestByPair.set(k, a);
  }
  answers.push(...latestByPair.values());
  const { data: sectionsRaw } = await supabase.from("survey_sections").select("id, title");
  const sectionTitle = new Map(((sectionsRaw ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title]));

  // Roster attributes for everyone referenced (for personal filters + attribute breakdowns).
  const muminIds = Array.from(new Set([...recips, ...answers].map((r) => r.mumin_id).filter((x): x is string => Boolean(x))));
  const attr = new Map<string, MuminAttr>();
  for (let i = 0; i < muminIds.length; i += 500) {
    const { data } = await supabase
      .from("mumineen")
      .select("id, full_name, its, age, gender, local_mehman, rahat_seating, wheelchair, jamaat, category")
      .in("id", muminIds.slice(i, i + 500));
    for (const m of (data ?? []) as { id: string; full_name: string | null; its: string | null; age: number | null; gender: string | null; local_mehman: string | null; rahat_seating: boolean | null; wheelchair: boolean | null; jamaat: string | null; category: string | null }[]) {
      attr.set(m.id, { name: m.full_name, its: m.its, age: m.age, gender: m.gender, local_mehman: m.local_mehman, rahat: Boolean(m.rahat_seating || m.wheelchair), jamaat: m.jamaat, category: m.category });
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

  // Recipients in filter (non-test unless includeTest) → response-rate. Counted as DISTINCT people:
  // "sent" = unique mumineen the survey went to, "responded" = unique mumineen who completed it.
  const testRecipIds = new Set(recips.filter((r) => r.is_test).map((r) => r.id));
  const fRecips = recips.filter((r) => (f.includeTest || !r.is_test) && passesPersonal(r.mumin_id));
  const sentMumin = new Set(fRecips.map((r) => r.mumin_id).filter((x): x is string => Boolean(x)));
  const respondedMumin = new Set(fRecips.filter((r) => r.status === "completed").map((r) => r.mumin_id).filter((x): x is string => Boolean(x)));

  // Answers in filter: area/section + date range + personal + (test exclusion via recipient).
  const fAnswers = answers.filter((a) => {
    if (!f.includeTest && testRecipIds.has(a.recipient_id)) return false;
    if (f.areas?.length && (!a.area || !f.areas.includes(a.area))) return false;
    if (f.sectionIds?.length && (!a.section_id || !f.sectionIds.includes(a.section_id))) return false;
    if (f.dateFrom && (!a.event_date || a.event_date < f.dateFrom)) return false;
    if (f.dateTo && (!a.event_date || a.event_date > f.dateTo)) return false;
    return passesPersonal(a.mumin_id);
  });

  // ---- Aggregations (all over fAnswers) ----
  const scored = fAnswers.filter((a) => a.sentiment_1_5 != null).map((a) => a.sentiment_1_5 as number);
  const distribution = [1, 2, 3, 4, 5].map((n) => ({ score: n, count: scored.filter((s) => s === n).length }));

  // Group scored answers by a key, tracking both the score list (for the mean / answer count) and
  // the distinct mumineen (so a row reads "60 people · 278 answers · 4.6/5").
  const group = <K extends string>(keyFn: (a: (typeof fAnswers)[number]) => K | null) => {
    const m = new Map<K, { scores: number[]; people: Set<string> }>();
    for (const a of fAnswers) {
      if (a.sentiment_1_5 == null) continue;
      const k = keyFn(a);
      if (k == null) continue;
      let g = m.get(k);
      if (!g) m.set(k, (g = { scores: [], people: new Set<string>() }));
      g.scores.push(a.sentiment_1_5);
      if (a.mumin_id) g.people.add(a.mumin_id);
    }
    return m;
  };
  const toRows = <K extends string>(m: Map<K, { scores: number[]; people: Set<string> }>) =>
    Array.from(m.entries()).map(([key, g]) => ({ key, sentiment: mean(g.scores), responses: g.scores.length, people: g.people.size })).sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0));

  const bySection = toRows(group((a) => (a.section_id ? (sectionTitle.get(a.section_id) ?? "Section") : null)));
  const byArea = toRows(group((a) => a.area));
  const byMehman = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.local_mehman ?? null : null)));
  const byGender = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.gender ?? null : null)));
  const byAge = toRows(group((a) => (a.mumin_id ? ageBucket(attr.get(a.mumin_id)?.age ?? null) : null)));
  const byRahat = toRows(group((a) => (a.mumin_id ? (attr.get(a.mumin_id)?.rahat ? "Rahat / accessibility" : "General") : null)));
  const byJamaat = toRows(group((a) => (a.mumin_id ? attr.get(a.mumin_id)?.jamaat ?? null : null))).slice(0, 20);
  // Sentiment trend by send-date (chronological), so day-over-day movement is visible.
  const byDay = toRows(group((a) => a.event_date)).sort((a, b) => (a.key < b.key ? -1 : 1));

  // Per question: sentiment + answer breakdown + its section (so the UI can group questions).
  const qText = new Map<string, string>();
  const qScores = new Map<string, number[]>();
  const qBreakdown = new Map<string, Record<string, number>>();
  const qSection = new Map<string, string | null>();
  for (const a of fAnswers) {
    if (!a.question_id) continue;
    if (a.sentiment_1_5 != null) (qScores.get(a.question_id) ?? qScores.set(a.question_id, []).get(a.question_id)!).push(a.sentiment_1_5);
    if (a.answer_text) {
      const b = qBreakdown.get(a.question_id) ?? {};
      b[a.answer_text] = (b[a.answer_text] ?? 0) + 1;
      qBreakdown.set(a.question_id, b);
    }
    if (!qSection.has(a.question_id)) qSection.set(a.question_id, a.section_id ? sectionTitle.get(a.section_id) ?? null : null);
  }
  // Question text from form snapshots.
  const { data: fqs } = await supabase.from("survey_form_questions").select("question_id, section_id, snapshot").in("form_id", scopeFormIds.length ? scopeFormIds : ["00000000-0000-0000-0000-000000000000"]);
  for (const fq of (fqs ?? []) as { question_id: string | null; section_id: string | null; snapshot: { text?: string; section_title?: string } }[]) {
    if (!fq.question_id) continue;
    if (fq.snapshot?.text) qText.set(fq.question_id, fq.snapshot.text);
    if (!qSection.get(fq.question_id)) qSection.set(fq.question_id, fq.snapshot?.section_title ?? (fq.section_id ? sectionTitle.get(fq.section_id) ?? null : null));
  }
  const byQuestion = Array.from(new Set([...qScores.keys(), ...qBreakdown.keys()])).map((qid) => ({
    question_id: qid,
    text: qText.get(qid) ?? "Question",
    section: qSection.get(qid) ?? null,
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

  // Drill-down: who answered what at the requested sentiment score (admin-only detail view).
  let responses: Array<{ name: string | null; its: string | null; question: string | null; answer: string | null; section: string | null; area: string | null; reason: string | null }> | undefined;
  if (f.drillScore != null) {
    responses = fAnswers
      .filter((a) => a.sentiment_1_5 === f.drillScore)
      .map((a) => {
        const m = a.mumin_id ? attr.get(a.mumin_id) : undefined;
        return {
          name: m?.name ?? null,
          its: m?.its ?? null,
          question: a.question_id ? qText.get(a.question_id) ?? null : null,
          answer: a.answer_text,
          section: a.section_id ? sectionTitle.get(a.section_id) ?? null : null,
          area: a.area,
          reason: a.reason_text,
        };
      })
      .sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""))
      .slice(0, 2000);
  }

  return NextResponse.json({
    forms: allForms.map((x) => ({ id: x.id, title: x.title, status: x.status, tags: x.tags ?? [], event_date: x.event_date, sent_at: x.sent_at })),
    options: { jamaats: jamaatOpts, categories: categoryOpts, sections: Array.from(sectionTitle.entries()).map(([id, title]) => ({ id, title })) },
    overview: {
      sent: sentMumin.size,
      responded: respondedMumin.size,
      response_rate: sentMumin.size ? Number((respondedMumin.size / sentMumin.size).toFixed(2)) : 0,
      avg_sentiment: mean(scored),
      scored_answers: scored.length, // # of scored answers behind the distribution/avg (caption only)
      comment_count: comments.length,
    },
    distribution,
    by_section: bySection,
    by_area: byArea,
    by_question: byQuestion,
    by_attribute: { local_mehman: byMehman, gender: byGender, age: byAge, rahat: byRahat, jamaat: byJamaat },
    by_day: byDay,
    comments,
    ...(responses ? { drill_score: f.drillScore, responses } : {}),
  });
}
