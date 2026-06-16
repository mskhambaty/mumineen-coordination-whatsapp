import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { suggestSample } from "@/lib/surveys/sampling";
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

  const { data: form } = await supabase.from("survey_forms").select("group_id, sample_size").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const f = form as { group_id: string | null; sample_size: number };
  if (!f.group_id) return NextResponse.json({ error: "Form has no target group." }, { status: 400 });

  const { data: group } = await supabase.from("survey_groups").select("rules").eq("id", f.group_id).maybeSingle();
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 400 });

  const { data: fqs } = await supabase.from("survey_form_questions").select("question_id").eq("form_id", id);
  const questionIds = ((fqs ?? []) as { question_id: string | null }[]).map((q) => q.question_id).filter((q): q is string => Boolean(q));

  const sample = await suggestSample((group as { rules: RuleGroup }).rules, questionIds, f.sample_size, chicagoToday());
  // PII-minimal preview: funnel + first names only (no phones).
  return NextResponse.json({
    funnel: sample.funnel,
    sample_names: sample.chosen.slice(0, 25).map((c) => (c.fullName ?? "").split(" ")[0] || "Mumin"),
  });
}
