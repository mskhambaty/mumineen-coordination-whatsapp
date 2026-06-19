import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { suggestSample, suggestSamplePlan, type Stratum, type SampleResult } from "@/lib/surveys/sampling";
import { chicagoToday } from "@/lib/surveys/tokens";
import type { RuleGroup } from "@/lib/whatsapp/audience-filter";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/preview — dry-run the sample (fresh-first, dedup) with NO
// writes, so the admin sees the funnel before committing/sending.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: form } = await supabase.from("survey_forms").select("group_id, rules, sample_plan, sample_size").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const f = form as { group_id: string | null; rules: RuleGroup | null; sample_plan: Stratum[] | null; sample_size: number };

  // Target: a stratified sample_plan OR a saved group OR an ad-hoc custom filter.
  let targetRules: RuleGroup | null = f.rules;
  const plan = Array.isArray(f.sample_plan) && f.sample_plan.length > 0 ? f.sample_plan : null;
  if (!plan) {
    if (f.group_id) {
      const { data: group } = await supabase.from("survey_groups").select("rules").eq("id", f.group_id).maybeSingle();
      if (!group) return NextResponse.json({ error: "Group not found." }, { status: 400 });
      targetRules = (group as { rules: RuleGroup }).rules;
    }
    if (!targetRules) return NextResponse.json({ error: "Form has no target group or filter." }, { status: 400 });
  }

  const { data: fqs } = await supabase.from("survey_form_questions").select("question_id").eq("form_id", id);
  const questionIds = ((fqs ?? []) as { question_id: string | null }[]).map((q) => q.question_id).filter((q): q is string => Boolean(q));

  const body = (await req.json().catch(() => ({}))) as { freeWindowOnly?: unknown; excludeAlreadySent?: unknown };
  const freeWindowOnly = body.freeWindowOnly === true;
  const excludeAlreadySent = body.excludeAlreadySent === true;
  const sample: SampleResult & { strata?: Array<{ label: string; requested: number; got: number; candidates: number }> } = plan
    ? await suggestSamplePlan(plan, questionIds, chicagoToday(), { freeWindowOnly, excludeAlreadySent })
    : await suggestSample(targetRules as RuleGroup, questionIds, f.sample_size, chicagoToday(), { freeWindowOnly, excludeAlreadySent });
  // Admin-gated preview: return the chosen sample (name + ITS + freshness) so the admin can search
  // it and verify a specific person was selected. No phone numbers.
  return NextResponse.json({
    funnel: sample.funnel,
    strata: sample.strata ?? null,
    sample: sample.chosen.map((c) => ({ name: c.fullName ?? "—", its: c.its, fresh: c.priorSends === 0 })),
  });
}
