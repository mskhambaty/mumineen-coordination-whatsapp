import { NextRequest, NextResponse } from "next/server";

import { isAdminOrLeadership } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { generateSurveyToken, chicagoToday } from "@/lib/surveys/tokens";
import { surveyLink } from "@/lib/surveys/send";

export const runtime = "nodejs";

// POST /api/admin/surveys/forms/[id]/test-link — mint a throwaway tokenized link for the admin to
// preview/test the real form flow (open + submit) without touching a real mumin. The recipient is
// flagged is_test=true, writes NO question exposures, and is excluded from results, so it never
// pollutes sampling or analytics.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalCaller(req, isAdminOrLeadership);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: form } = await supabase.from("survey_forms").select("id, group_id").eq("id", id).maybeSingle();
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  const { count } = await supabase.from("survey_form_questions").select("id", { count: "exact", head: true }).eq("form_id", id);
  if (!count) return NextResponse.json({ error: "Compose questions for this form first." }, { status: 400 });

  // Optional: impersonate a real ITS so the test form greets that mumin by first name (otherwise
  // it shows a generic "you"). Test recipients still write no exposures and are excluded from results.
  const body = (await req.json().catch(() => ({}))) as { its?: unknown };
  let muminId: string | null = null;
  let familyId: string | null = null;
  let name: string | null = null;
  const its = typeof body.its === "string" ? body.its.trim() : "";
  if (its) {
    const { data: mumin } = await supabase
      .from("mumineen")
      .select("id, family_id, full_name")
      .eq("its", its)
      .eq("roster_active", true)
      .maybeSingle();
    if (!mumin) return NextResponse.json({ error: `ITS ${its} not found in the active roster.` }, { status: 400 });
    const m = mumin as { id: string; family_id: string | null; full_name: string | null };
    muminId = m.id;
    familyId = m.family_id;
    name = m.full_name;
  }

  const token = generateSurveyToken();
  const { error } = await supabase.from("survey_recipients").insert({
    form_id: id,
    mumin_id: muminId,
    family_id: familyId,
    group_id: (form as { group_id: string | null }).group_id,
    token,
    status: "sampled",
    is_test: true,
    event_date: chicagoToday(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ link: surveyLink(token), token, name });
}
